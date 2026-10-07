/**
 * Sends one call from the visitor's wallet so that it reaches X Layer Testnet. Since the network's
 * stall on 6 October, a transaction a wallet broadcast through its own node could be dropped with no
 * error: on 7 October two OKX Wallet transactions returned a hash that neither the public RPC nor the
 * explorer ever saw. So the app names the fee itself, twice the network's gas price, with the gas
 * limit and the nonce the chain has confirmed, counted no earlier than the block in which the page
 * last saw one of the wallet's transactions mined. It first asks the wallet only to sign, and sends the
 * signed transaction to the public RPC itself, the way the relayer and the keeper do; a wallet that
 * cannot sign without sending is asked to send, with the same fee and nonce.
 */
import { keccak256, type Hex } from "viem";
import { FUND_WALLET_CHAIN, atBlock, fundRpc, hexBlock, quantity, readBlock, walletMinedBlock, type Rpc, type TransactionCall } from "./fund";

export type WalletProvider = { request: (request: { method: string; params?: unknown[] }) => Promise<unknown> };

const hexQuantity = (value: bigint) => `0x${value.toString(16)}`;

/** The fee the app names: twice the network's price, so a node that holds an older copy or a higher floor still takes it. */
export type WalletFee = { gasPrice: string; gas: string | null; nonce: string };

export async function walletFee(from: string, request: TransactionCall, rpc: Rpc = fundRpc()): Promise<WalletFee> {
  // After a step of the page's own has been mined, the next is counted and estimated at that block or
  // later, asked again until a node that has reached it answers; otherwise at the latest block.
  const mined = walletMinedBlock(from);
  const tag = mined ? hexBlock(await readBlock(rpc, mined)) : "latest";
  const pinned = <T>(read: () => Promise<T>, attempts?: number) => mined ? atBlock(read, attempts) : read();
  const call = { from, to: request.to, data: request.data };
  const [price, nonce] = await Promise.all([rpc("eth_gasPrice", []), pinned(() => rpc("eth_getTransactionCount", [from, tag]))]);
  let gas: string | null = null;
  try {
    // A fifth more than the estimate; a step that still does not estimate leaves the gas to the wallet.
    const estimate = quantity(await pinned(() => rpc("eth_estimateGas", mined ? [call, tag] : [call]), 4));
    gas = hexQuantity((estimate * 6n) / 5n + 10_000n);
  } catch { /* The wallet estimates it. */ }
  return { gasPrice: hexQuantity(quantity(price) * 2n), gas, nonce: hexQuantity(quantity(nonce)) };
}

const cancelled = (error: unknown) => {
  const record = (error ?? {}) as { code?: unknown; message?: unknown };
  return record.code === 4001 || /user (rejected|denied|cancel)/i.test(typeof record.message === "string" ? record.message : "");
};

/** A signed transaction from eth_signTransaction: the raw hex, or geth's { raw }. */
function rawTransaction(value: unknown): Hex | null {
  const raw = typeof value === "string" ? value : (value as { raw?: unknown } | null)?.raw;
  return typeof raw === "string" && /^0x[0-9a-f]{100,}$/i.test(raw) ? raw as Hex : null;
}

/**
 * Sends `request` from `from`. Returns the transaction hash. A cancellation in the wallet is thrown
 * as the wallet reported it; any other failure to sign falls back to the wallet sending.
 */
export async function sendWalletTransaction(provider: WalletProvider, from: string, request: TransactionCall, rpc: Rpc = fundRpc()): Promise<string> {
  let fee: WalletFee | null = null;
  try { fee = await walletFee(from, request, rpc); } catch { /* The public RPC is unreachable: the wallet sends as it would. */ }
  if (fee?.gas) {
    let signed: unknown = null;
    try {
      signed = await provider.request({ method: "eth_signTransaction", params: [{ from, to: request.to, data: request.data, chainId: FUND_WALLET_CHAIN.chainId, gas: fee.gas, gasPrice: fee.gasPrice, nonce: fee.nonce, value: "0x0" }] });
    } catch (error) {
      if (cancelled(error)) throw error;
    }
    const raw = rawTransaction(signed);
    if (raw) {
      const hash = keccak256(raw);
      try { await rpc("eth_sendRawTransaction", [raw]); } catch (error) {
        // The wallet may have broadcast it too.
        if (!/already known|known transaction|already imported/i.test(error instanceof Error ? error.message : "")) throw error;
      }
      return hash;
    }
  }
  // The confirmed nonce too: a wallet that still counts a transaction its node dropped would otherwise
  // number this one after it, and no node takes a transaction behind a gap (7 October, OKX Wallet).
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from, to: request.to, data: request.data, ...(fee ? { gasPrice: fee.gasPrice, nonce: fee.nonce } : {}), ...(fee?.gas ? { gas: fee.gas } : {}) }] });
  if (typeof hash !== "string") throw new Error("The wallet did not return a transaction.");
  return hash;
}
