/**
 * Ganymede settlement relayer.
 *
 * Implements exactly the API the engine already expects (lib/engine/settlement.ts):
 *
 *   POST /v1/settlements                        Bearer + Idempotency-Key
 *   GET  /v1/eligibility/{address}              Bearer
 *   GET  /v1/dojang/verified-address/{address}  Bearer (alias of the above)
 *
 * Signs for the chain named by SETTLEMENT_CHAIN — X Layer testnet by default.
 *
 * This is the only component in the system that holds an EVM private key. It is
 * deployed separately from the application for that reason.
 */
import { createPublicClient, http, type Address } from "viem";
import { settlementChain } from "./chain";
import type { Env } from "./env";
import { FUND_SHARE_ABI, RequestError, type SettlementRequest } from "./contracts";
import { idempotencyKey } from "./ids";
import { readSettlement } from "./store";

export { Submitter } from "./submitter";

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function authorize(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  const expected = env.RELAYER_API_TOKEN ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  // Constant-time compare — this token is the only thing gating share issuance.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

const REQUIRED_FIELDS: Array<keyof SettlementRequest> = ["entityType", "entityId", "action", "productId", "effectiveAt"];

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v1/health") {
      return handleHealth(env);
    }

    if (!authorize(request, env)) return unauthorized();

    if (url.pathname === "/v1/settlements" && request.method === "POST") {
      return handleSettlement(request, env);
    }

    const eligibility = url.pathname.match(/^\/v1\/(?:eligibility|dojang\/verified-address)\/(0x[a-fA-F0-9]{40})$/);
    if (eligibility && request.method === "GET") {
      return handleEligibility(eligibility[1] as Address, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

export default worker;

async function handleSettlement(request: Request, env: Env): Promise<Response> {
  let body: SettlementRequest;
  try {
    body = (await request.json()) as SettlementRequest;
  } catch {
    return Response.json({ error: "Body must be JSON", code: "invalid_json" }, { status: 400 });
  }

  const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
  if (missing.length > 0) {
    return Response.json({ error: `missing fields: ${missing.join(", ")}`, code: "invalid_request" }, { status: 400 });
  }

  const key = idempotencyKey(body.entityType, body.entityId, body.action);
  const headerKey = request.headers.get("idempotency-key");
  if (headerKey && headerKey !== key) {
    // The engine derives this header from the same three fields. A mismatch
    // means the body and header disagree about which settlement this is.
    return Response.json(
      { error: "Idempotency-Key does not match the request body", code: "idempotency_mismatch" },
      { status: 400 },
    );
  }

  // Fast path: already settled, no need to wake the submitter.
  const existing = await readSettlement(env.DB, key);
  if (existing?.status === "confirmed") {
    return Response.json(toResponse(existing, env), { status: 200 });
  }

  // All submissions funnel through one Durable Object so nonces stay ordered.
  // One submitter per chain: a nonce belongs to a (signer, chain) pair.
  const id = env.SUBMITTER.idFromName(`submitter-${settlementChain(env.SETTLEMENT_CHAIN).chain.id}`);
  const stub = env.SUBMITTER.get(id);
  const response = await stub.fetch("https://submitter/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) return response;
  const record = (await response.json()) as Awaited<ReturnType<typeof readSettlement>>;
  return Response.json(toResponse(record!, env), { status: 200 });
}

function toResponse(record: NonNullable<Awaited<ReturnType<typeof readSettlement>>>, env: Env) {
  const { chain } = settlementChain(env.SETTLEMENT_CHAIN);
  return {
    status: record.status,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    note: record.note,
    explorer: record.txHash && chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${record.txHash}` : null,
  };
}

function publicClient(env: Env) {
  const { chain } = settlementChain(env.SETTLEMENT_CHAIN);
  return createPublicClient({ chain, transport: http(env.SETTLEMENT_RPC_URL || chain.rpcUrls.default.http[0]) });
}

/**
 * Can this wallet receive fund shares?
 *
 * X Layer: reads the share ledger's own allowlist. That is the exact check a
 * mint enforces, so the answer is truthful rather than a stub.
 *
 * GIWA Sepolia: carries no real Upbit Korea Verified Address attestation, so it
 * checks DOJANG_TESTNET_ALLOWLIST and reports `source: "testnet-stub"` so a
 * caller can never mistake it for a real attestation. Mainnet replaces this
 * with a read against the Dojang scroll.
 */
async function handleEligibility(address: Address, env: Env): Promise<Response> {
  const { key } = settlementChain(env.SETTLEMENT_CHAIN);

  if (key === "giwa-sepolia") {
    const allowlist = (env.DOJANG_TESTNET_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const verified = allowlist.includes(address.toLowerCase());
    return Response.json({
      verified,
      source: "testnet-stub",
      reason: verified ? null : "not in the testnet Dojang allowlist",
    });
  }

  const shareAddress = env.FUND_SHARE_ADDRESS ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(shareAddress)) {
    return Response.json({ error: "FUND_SHARE_ADDRESS is not configured", code: "contract_unconfigured" }, { status: 500 });
  }
  try {
    const verified = await publicClient(env).readContract({
      address: shareAddress as Address,
      abi: FUND_SHARE_ABI,
      functionName: "isAllowed",
      args: [address],
    });
    return Response.json({
      verified,
      source: "onchain-allowlist",
      reason: verified ? null : "not allowlisted on the fund share ledger",
    });
  } catch (error) {
    console.error("Eligibility read failed", error);
    return Response.json({ error: "RPC unreachable", code: "rpc_unavailable" }, { status: 503 });
  }
}

async function handleHealth(env: Env): Promise<Response> {
  let key: string;
  try {
    key = settlementChain(env.SETTLEMENT_CHAIN).key;
  } catch (error) {
    return Response.json({ ready: false, error: (error as Error).message }, { status: 503 });
  }
  const client = publicClient(env);
  try {
    const [blockNumber, chainId] = await Promise.all([client.getBlockNumber(), client.getChainId()]);
    // An RPC for another network would sign nothing useful; report it rather than ready.
    const expected = settlementChain(env.SETTLEMENT_CHAIN).chain.id;
    return Response.json({
      ready: chainId === expected,
      ...(chainId === expected ? {} : { error: `RPC reports chain ${chainId}, expected ${expected}` }),
      chain: key,
      chainId,
      blockNumber: blockNumber.toString(),
      contracts: {
        fundShare: env.FUND_SHARE_ADDRESS ?? null,
        navRegistry: env.NAV_REGISTRY_ADDRESS ?? null,
      },
      signerConfigured: /^0x[0-9a-fA-F]{64}$/.test(env.RELAYER_PRIVATE_KEY ?? ""),
    });
  } catch (error) {
    // The error can quote the RPC URL and any key in it; this route is unauthenticated.
    console.error("Health RPC read failed", error);
    return Response.json({ ready: false, chain: key, error: "RPC unreachable" }, { status: 503 });
  }
}

export { RequestError };
