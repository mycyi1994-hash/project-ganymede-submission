import type { Address } from "viem";

/**
 * Sending again at a nonce some node may already hold a transaction for. On 6 October 2026 X Layer
 * Testnet stopped producing blocks for 87 minutes; the transactions sent meanwhile never reached the
 * chain, while some RPC nodes kept counting them, so every later send waited behind the gap. A node
 * replaces a transaction it holds only for fees more than 10% higher, so a send at such a nonce pays
 * at least double the network's estimate, and double again for each earlier try at the same nonce.
 */

/** The least tip such a send offers: 0.001 gwei, where X Layer's own estimate is 1 wei. */
const MIN_TIP = 1_000_000n;

export type Fees = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };

export async function outbidFees(client: { estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> }, times: number): Promise<Fees> {
  const estimate = await client.estimateFeesPerGas();
  if (estimate.maxFeePerGas === undefined || estimate.maxPriorityFeePerGas === undefined) throw new Error("The network gave no EIP-1559 fees to outbid with.");
  const factor = 2n ** BigInt(Math.max(1, Math.min(times, 8)));
  const tip = (estimate.maxPriorityFeePerGas > MIN_TIP ? estimate.maxPriorityFeePerGas : MIN_TIP) * factor;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: estimate.maxFeePerGas * factor + tip };
}

type NonceReader = { getTransactionCount(args: { address: Address; blockTag: "latest" | "pending" }): Promise<number> };

/** The chain's own count of an account's transactions, and the count of a node that also counts the ones it holds. */
export async function nonceCounts(client: NonceReader, address: Address): Promise<{ latest: number; pending: number }> {
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "latest" }),
    client.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  return { latest, pending };
}
