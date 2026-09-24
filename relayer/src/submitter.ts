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
import { classifyRevert, planCall, RequestError, type SettlementRequest } from "./contracts";
import { idempotencyKey } from "./ids";
import { readSettlement, writeSettlement, type StoredSettlement } from "./store";
import type { Env } from "./env";
import { settlementChain } from "./chain";

const RECEIPT_TIMEOUT_MS = 20_000;

export class Submitter implements DurableObject {
  private nextNonce: number | null = null;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const settlement = (await request.json()) as SettlementRequest;
    try {
      const result = await this.submit(settlement);
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof RequestError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      const message = error instanceof Error ? error.message : "settlement failed";
      return Response.json({ error: message, code: "submission_failed" }, { status: 502 });
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
    if (existing && existing.status !== "failed") return existing;

    const plan = planCall(request);
    const address = this.contractAddress(plan.target);
    const { account, publicClient, walletClient } = this.clients();

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
      const disposition = classifyRevert(revertName(error));
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
      // A nonce that drifted (restart, external send) is recoverable: resync and
      // let the engine's next retry through rather than poisoning the queue.
      await this.resyncNonce(publicClient, account.address);
      throw error;
    }

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
