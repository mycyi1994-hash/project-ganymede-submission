import { resolveSettlementChain, type SettlementChain } from "../chains";
import { newId, sha256Hex, stableJson } from "./fixed";
import type { EngineEnv } from "./types";

export type SettlementRequest = {
  entityType: "nav" | "subscription" | "redemption" | "rebalance";
  entityId: string;
  action: "publish_nav" | "mint_subscription" | "burn_redemption" | "publish_rebalance";
  walletAddress?: string | null;
  productId: string;
  amount?: string;
  navPerShareMicros?: string;
  /** Required by GanymedeNavRegistry.publishNav; omitted the relayer publishes 0. */
  sharesOutstandingMicros?: string;
  sharesMicros?: string;
  holdingsHash?: string;
  effectiveAt: string;
};

export type SettlementResult = {
  id: string;
  payloadHash: string;
  status: "queued" | "submitted" | "confirmed" | "failed" | "simulated";
  txHash: string | null;
  blockNumber: string | null;
  error: string | null;
};

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Settlement RPC ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Settlement RPC error");
  if (payload.result === undefined) throw new Error("Settlement RPC returned no result");
  return payload.result;
}

/**
 * Talks to the external settlement relayer (relayer/). The relayer holds the
 * signing key; this client never does. SETTLEMENT_CHAIN picks the rail —
 * X Layer testnet by default.
 */
export class SettlementClient {
  private readonly env: EngineEnv;
  readonly chain: SettlementChain;
  readonly rpcUrl: string;

  constructor(env: EngineEnv) {
    this.env = env;
    this.chain = resolveSettlementChain(env.SETTLEMENT_CHAIN);
    this.rpcUrl = env.SETTLEMENT_RPC_URL || this.chain.rpcUrl;
  }

  async health(): Promise<{ chain: string; chainName: string; explorerUrl: string; configured: boolean; connected: boolean; blockNumber: string | null; chainId: number; relayer: boolean; error: string | null }> {
    const base = {
      chain: this.chain.key,
      chainName: this.chain.name,
      explorerUrl: this.chain.explorerUrl,
      configured: Boolean(this.env.FUND_SHARE_ADDRESS || this.env.NAV_REGISTRY_ADDRESS),
      relayer: Boolean(this.env.SETTLEMENT_RELAYER_URL && this.env.SETTLEMENT_RELAYER_TOKEN),
    };
    try {
      const [blockHex, chainHex] = await Promise.all([
        rpc<string>(this.rpcUrl, "eth_blockNumber", []),
        rpc<string>(this.rpcUrl, "eth_chainId", []),
      ]);
      const chainId = Number(BigInt(chainHex));
      return {
        ...base,
        // An RPC answering for a different chain is not a working rail.
        connected: chainId === this.chain.chainId,
        blockNumber: BigInt(blockHex).toString(),
        chainId,
        error: chainId === this.chain.chainId ? null : `RPC reports chain ${chainId}, expected ${this.chain.chainId}`,
      };
    } catch (error) {
      return {
        ...base,
        connected: false,
        blockNumber: null,
        chainId: this.chain.chainId,
        error: error instanceof Error ? error.message : "Unknown settlement RPC error",
      };
    }
  }

  async verifyAddress(walletAddress: string): Promise<{ verified: boolean; source: "relayer" | "unavailable"; reason: string | null }> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return { verified: false, source: "unavailable", reason: "Invalid EVM address" };
    if (!this.env.SETTLEMENT_RELAYER_URL || !this.env.SETTLEMENT_RELAYER_TOKEN) {
      return { verified: false, source: "unavailable", reason: "Settlement relayer is not configured" };
    }
    try {
      const response = await fetch(`${this.env.SETTLEMENT_RELAYER_URL.replace(/\/$/, "")}/v1/eligibility/${walletAddress}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.env.SETTLEMENT_RELAYER_TOKEN}`, Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Relayer ${response.status}`);
      const payload = await response.json() as { verified?: boolean; reason?: string | null };
      return { verified: payload.verified === true, source: "relayer", reason: payload.verified ? null : payload.reason ?? "Wallet is not eligible to hold fund shares" };
    } catch (error) {
      return { verified: false, source: "unavailable", reason: error instanceof Error ? error.message : "Verification failed" };
    }
  }

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    const payloadHash = await sha256Hex(stableJson(request));
    const id = newId("stl");
    if (!this.env.SETTLEMENT_RELAYER_URL || !this.env.SETTLEMENT_RELAYER_TOKEN) {
      return { id, payloadHash, status: "simulated", txHash: null, blockNumber: null, error: "Settlement relayer is not configured" };
    }
    try {
      const response = await fetch(`${this.env.SETTLEMENT_RELAYER_URL.replace(/\/$/, "")}/v1/settlements`, {
        signal: AbortSignal.timeout(20_000),
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.SETTLEMENT_RELAYER_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": `${request.entityType}:${request.entityId}:${request.action}` },
        body: JSON.stringify({
          chainId: this.chain.chainId,
          shareContract: this.env.FUND_SHARE_ADDRESS ?? null,
          navRegistry: this.env.NAV_REGISTRY_ADDRESS ?? null,
          payloadHash,
          ...request,
        }),
      });
      if (!response.ok) throw new Error(`Settlement relayer ${response.status}: ${await response.text()}`);
      const payload = await response.json() as { status?: "queued" | "submitted" | "confirmed"; txHash?: string; blockNumber?: string };
      return { id, payloadHash, status: payload.status ?? "queued", txHash: payload.txHash ?? null, blockNumber: payload.blockNumber ?? null, error: null };
    } catch (error) {
      return { id, payloadHash, status: "failed", txHash: null, blockNumber: null, error: error instanceof Error ? error.message : "Settlement failed" };
    }
  }
}
