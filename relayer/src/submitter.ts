/**
 * Durable Object that owns the relayer's hot key and its nonce.
 *
 * Why a Durable Object: one engine cycle emits several settlements (4 NAV
 * publications + rebalances + fund flows). Signing those concurrently from a
 * stateless Worker hands the same nonce to several transactions and all but one
 * fail. A single DO instance serialises every submission through one queue, so
 * nonces are issued in order.
 *
 * It is also the only place a private key is read. The engine never holds one.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { classifyRevert, planCall, RequestError, FUND_SHARE_ABI, NAV_REGISTRY_ABI, type SettlementRequest } from "./contracts";
import { navPayloadHash, SubmissionQueue } from "./publication-evidence";
import { idempotencyKey } from "./ids";
import { readSettlement, writeSettlement, type StoredSettlement } from "./store";
import type { Env } from "./env";
import { settlementChain } from "./chain";

/** Well inside the app's 45 s request budget; an unconfirmed hash is reconciled on the next ask. */
const RECEIPT_TIMEOUT_MS = 12_000;
/** The one product whose shares live on the configured FundShare ledger. */
const DEFAULT_TOKENIZED_PRODUCT = "core-20";

export class Submitter implements DurableObject {
  private nextNonce: number | null = null;
  private queue = new SubmissionQueue();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const settlement = (await request.json()) as SettlementRequest;
    try {
      const result = await this.queue.run(() => this.submit(settlement));
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof RequestError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      // RPC errors can quote the provider URL (and any key in it); keep them in the log only.
      console.error("Settlement submission failed", error);
      return Response.json({ error: "Submission failed; retry with the same Idempotency-Key", code: "submission_failed" }, { status: 502 });
    }
  }

  private clients() {
    const key = this.env.RELAYER_PRIVATE_KEY;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
      throw new RequestError("RELAYER_PRIVATE_KEY secret is missing or malformed", 500, "relayer_unconfigured");
    }
    const account = privateKeyToAccount(key as Hex);
    const { chain } = settlementChain(this.env.SETTLEMENT_CHAIN);
    const transport = http(this.env.SETTLEMENT_RPC_URL || chain.rpcUrls.default.http[0]);
    return {
      account,
      publicClient: createPublicClient({ chain, transport }),
      walletClient: createWalletClient({ account, chain, transport }),
    };
  }

  private contractAddress(target: "fundShare" | "navRegistry"): Address {
    const raw = target === "fundShare" ? this.env.FUND_SHARE_ADDRESS : this.env.NAV_REGISTRY_ADDRESS;
    if (!/^0x[a-fA-F0-9]{40}$/.test(raw ?? "")) {
      throw new RequestError(`${target} address is not configured on the relayer`, 500, "contract_unconfigured");
    }
    return raw as Address;
  }

  /** Nonce is issued here and nowhere else, so concurrent cycles cannot collide. */
  private async takeNonce(publicClient: ReturnType<typeof this.clients>["publicClient"], address: Address) {
    if (this.nextNonce === null) {
      this.nextNonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
    }
    const nonce = this.nextNonce;
    this.nextNonce = nonce + 1;
    return nonce;
  }

  private async resyncNonce(publicClient: ReturnType<typeof this.clients>["publicClient"], address: Address) {
    this.nextNonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
  }

  private async submit(request: SettlementRequest): Promise<StoredSettlement> {
    const key = idempotencyKey(request.entityType, request.entityId, request.action);

    // Replay guard #1: our own record. Cheap, and covers the common retry.
    const existing = await readSettlement(this.env.DB, key);
    if (existing?.status === "confirmed") return existing;

    let plan: ReturnType<typeof planCall>;
    try {
      plan = planCall(request);
    } catch (error) {
      // Malformed amounts, hashes or times are the caller's to fix, never worth a retry.
      if (error instanceof RequestError) throw error;
      throw new RequestError(error instanceof Error ? error.message : "invalid settlement request", 400, "invalid_request");
    }
    if (plan.target === "fundShare" && request.productId !== (this.env.FUND_SHARE_PRODUCT_ID || DEFAULT_TOKENIZED_PRODUCT)) {
      // One FundShare ledger holds one product; minting another product there would mix cap tables.
      throw new RequestError(`${request.productId} has no share ledger on chain`, 409, "product_not_tokenized");
    }
    const address = this.contractAddress(plan.target);
    const { account, publicClient, walletClient } = this.clients();

    // A timeout is not permission to broadcast again. Reconcile the known hash.
    if (existing?.txHash && existing.status !== "failed") {
      let receipt;
      try { receipt = await publicClient.getTransactionReceipt({ hash: existing.txHash as Hex }); }
      catch { return existing; }
      const reconciled: StoredSettlement = { ...existing, status: receipt.status === "success" ? "confirmed" : "failed", blockNumber: receipt.blockNumber.toString(), error: receipt.status === "success" ? null : "transaction reverted on chain", updatedAt: new Date().toISOString() };
      await writeSettlement(this.env.DB, reconciled);
      return reconciled;
    }

    // Replay guard #2: simulate first. This is where the contract's own guards
    // (SettlementAlreadyProcessed, StalePublication, ...) surface without
    // spending gas on a transaction that is certain to revert.
    let simulated;
    try {
      simulated = await publicClient.simulateContract({
        account,
        address,
        abi: plan.abi as never,
        functionName: plan.functionName as never,
        args: plan.args as never,
      });
    } catch (error) {
      const name = revertName(error);
      let disposition = classifyRevert(name);
      if (name === "StalePublication" && plan.functionName === "publishNav") {
        const published = await publicClient.readContract({ address, abi: NAV_REGISTRY_ABI, functionName: "publishedPayload", args: [navPayloadHash(plan.args)] });
        if (published) disposition = { kind: "settled", reason: "exact NAV payload independently confirmed in registry history" };
      }
      // The share ledger checks the allowlist and pause before its replay guard, so a retry of
      // a mint that already landed can revert with another error. Ask the ledger directly.
      if (disposition?.kind !== "settled" && plan.target === "fundShare") {
        const processed = await publicClient.readContract({ address, abi: FUND_SHARE_ABI, functionName: "processedSettlement", args: [plan.args[0] as Hex] }).catch(() => false);
        if (processed) disposition = { kind: "settled", reason: "settlement id already processed on the share ledger" };
      }
      if (disposition?.kind === "settled") {
        const record: StoredSettlement = {
          key,
          status: "confirmed",
          txHash: existing?.txHash ?? null,
          blockNumber: existing?.blockNumber ?? null,
          error: null,
          note: disposition.reason,
          updatedAt: new Date().toISOString(),
        };
        await writeSettlement(this.env.DB, record);
        return record;
      }
      if (disposition) {
        await writeSettlement(this.env.DB, {
          key,
          status: "failed",
          txHash: null,
          blockNumber: null,
          error: disposition.reason,
          note: disposition.code,
          updatedAt: new Date().toISOString(),
        });
        throw new RequestError(disposition.reason, disposition.status, disposition.code);
      }
      throw error;
    }

    let txHash: Hex;
    try {
      txHash = await walletClient.writeContract({
        ...simulated.request,
        nonce: await this.takeNonce(publicClient, account.address),
      });
    } catch (error) {
      // A nonce that drifted (restart, external send) is recoverable. Forget the local
      // counter first, so that if the resync read also fails the next submission reads
      // the chain again instead of skipping a nonce and stalling behind the gap.
      this.nextNonce = null;
      await this.resyncNonce(publicClient, account.address).catch(() => undefined);
      throw error;
    }

    // Persist immediately after broadcast, before waiting for a receipt.
    await writeSettlement(this.env.DB, { key, status: "submitted", txHash, blockNumber: null, error: null, note: null, updatedAt: new Date().toISOString() });
    let status: StoredSettlement["status"] = "submitted";
    let blockNumber: string | null = null;
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
      status = receipt.status === "success" ? "confirmed" : "failed";
      blockNumber = receipt.blockNumber.toString();
    } catch {
      // Still in the mempool. The hash is real; the engine can poll it later.
      status = "submitted";
    }

    const record: StoredSettlement = {
      key,
      status,
      txHash,
      blockNumber,
      error: status === "failed" ? "transaction reverted on chain" : null,
      note: null,
      updatedAt: new Date().toISOString(),
    };
    await writeSettlement(this.env.DB, record);
    return record;
  }
}

/** Pulls the custom-error name out of a viem revert, if there is one. */
function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? reverted.reason ?? undefined;
  }
  return undefined;
}
