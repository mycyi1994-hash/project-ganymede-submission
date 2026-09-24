import { DEFAULT_SETTLEMENT_CHAIN } from "./chains";

// Pinned to onchain/deployments/xlayer-testnet.json. This is CORE's test ledger,
// not a USTX investment, a custody contract, or a token to which funds are sent.
export const LEDGER = {
  ...DEFAULT_SETTLEMENT_CHAIN,
  address: "0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59",
  name: "Ganymede Core 20",
  symbol: "GMDCORE",
  decimals: 6,
  historyBlocks: 2000,
} as const;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const isHash = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const isQuantity = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value);
export const isAddress = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
export function sharedWalletAccount(value: unknown): string {
  return Array.isArray(value) && isAddress(value[0]) ? value[0].toLowerCase() : "";
}
export function formatShares(value: string): string {
  const number = BigInt(value);
  return `${(number / 1_000_000n).toLocaleString("en-US")}.${(number % 1_000_000n).toString().padStart(6, "0")}`;
}
export type LedgerTransfer = { hash: string; index: number; block: number; from: string; to: string; units: string };
export type LedgerSnapshot = { account: string; block: number; blockTime: string; fromBlock: number; balance: string; supply: string; transfers: LedgerTransfer[] };
export type LedgerReceipt = { hash: string; block: number; blockTime: string; transfers: LedgerTransfer[] };
type RpcOptions = { fetcher?: typeof fetch; signal?: AbortSignal };
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error("The ledger returned an invalid value.");
  return BigInt(value);
}
function quantity(value: unknown): number {
  if (!isQuantity(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The ledger returned an invalid block.");
  return Number(BigInt(value));
}
function rpc(options: RpcOptions) {
  let id = 0;
  return async (method: string, params: unknown[]): Promise<unknown> => {
    const requestId = ++id;
    const response = await (options.fetcher ?? fetch)(LEDGER.rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
    if (!response.ok) throw new Error("The testnet ledger is temporarily unavailable.");
    const body = await response.json() as { id?: unknown; result?: unknown; error?: unknown };
    if (body.id !== requestId || body.error || body.result === undefined) throw new Error("The testnet ledger could not be read. Try again.");
    return body.result;
  };
}
type Rpc = ReturnType<typeof rpc>;
async function pinChain(call: Rpc): Promise<number> {
  if (quantity(await call("eth_chainId", [])) !== LEDGER.chainId) throw new Error("The network does not match X Layer Testnet.");
  const block = quantity(await call("eth_blockNumber", []));
  const code = await call("eth_getCode", [LEDGER.address, `0x${block.toString(16)}`]);
  if (typeof code !== "string" || !/^0x[0-9a-f]+$/i.test(code) || /^0x0*$/i.test(code)) throw new Error("The configured share ledger is unavailable.");
  return block;
}
async function blockTime(call: Rpc, block: number): Promise<string> {
  const result = await call("eth_getBlockByNumber", [`0x${block.toString(16)}`, false]) as { number?: unknown; timestamp?: unknown } | null;
  if (!result || quantity(result.number) !== block) throw new Error("The ledger block could not be confirmed.");
  const seconds = quantity(result.timestamp);
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("The ledger time is unavailable.");
  return date.toISOString();
}
export function ledgerTransfers(value: unknown, fromBlock: number, toBlock: number): LedgerTransfer[] {
  if (!Array.isArray(value) || value.length > 2000) throw new Error("The ledger history could not be read completely.");
  return value.flatMap((entry: Record<string, unknown>) => {
    if (!entry || typeof entry !== "object") throw new Error("The ledger history is invalid.");
    if (entry.removed === true || entry.address !== LEDGER.address && String(entry.address).toLowerCase() !== LEDGER.address) return [];
    const topics = entry.topics;
    if (!Array.isArray(topics) || topics[0] !== TRANSFER) return [];
    if (topics.length !== 3 || !isHash(topics[1]) || !isHash(topics[2]) || !/^0x0{24}/i.test(topics[1]) || !/^0x0{24}/i.test(topics[2]) || !isHash(entry.transactionHash)) throw new Error("The ledger transfer is invalid.");
    const block = quantity(entry.blockNumber);
    if (block < fromBlock || block > toBlock) throw new Error("The ledger history returned an unexpected block.");
    return [{ hash: entry.transactionHash.toLowerCase(), index: quantity(entry.logIndex), block, from: `0x${topics[1].slice(-40)}`.toLowerCase(), to: `0x${topics[2].slice(-40)}`.toLowerCase(), units: uint(entry.data).toString() }];
  });
}
export function transferLabel(transfer: LedgerTransfer, account?: string): string {
  if (transfer.from === ZERO) return "Shares issued";
  if (transfer.to === ZERO) return "Shares burned";
  if (transfer.from === transfer.to) return "Self transfer";
  return !account ? "Share transfer" : transfer.to === account.toLowerCase() ? "Shares received" : "Shares sent";
}
async function recentTransfers(call: Rpc, first: number, last: number, signal?: AbortSignal): Promise<LedgerTransfer[]> {
  // X Layer's public RPC accepts at most 100 blocks per log request. Bound
  // concurrency and filter the public contract's events locally by account.
  const rows: LedgerTransfer[] = [];
  let next = first;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next <= last) {
      signal?.throwIfAborted();
      const from = next;
      const to = Math.min(last, from + 99);
      next = to + 1;
      const logs = await call("eth_getLogs", [{ address: LEDGER.address, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TRANSFER] }]);
      rows.push(...ledgerTransfers(logs, from, to));
    }
  }));
  return rows;
}
export async function readLedger(account: string, options: RpcOptions = {}): Promise<LedgerSnapshot> {
  if (!isAddress(account)) throw new Error("Enter a valid EVM address.");
  account = account.toLowerCase();
  const call = rpc(options);
  const block = await pinChain(call);
  const tag = `0x${block.toString(16)}`;
  const fromBlock = Math.max(0, block - LEDGER.historyBlocks + 1);
  const [balance, supply, decimals, time, transfers] = await Promise.all([
    call("eth_call", [{ to: LEDGER.address, data: `0x70a08231${account.slice(2).padStart(64, "0")}` }, tag]),
    call("eth_call", [{ to: LEDGER.address, data: "0x18160ddd" }, tag]),
    call("eth_call", [{ to: LEDGER.address, data: "0x313ce567" }, tag]),
    blockTime(call, block),
    recentTransfers(call, fromBlock, block, options.signal),
  ]);
  if (uint(decimals) !== BigInt(LEDGER.decimals)) throw new Error("The share ledger decimals do not match its deployment.");
  const unique = new Map<string, LedgerTransfer>();
  for (const row of transfers) {
    if (row.from !== account && row.to !== account) continue;
    unique.set(`${row.hash}:${row.index}`, row);
  }
  return { account, block, fromBlock, blockTime: time, balance: uint(balance).toString(), supply: uint(supply).toString(), transfers: [...unique.values()].sort((a, b) => b.block - a.block || b.index - a.index) };
}
export async function readLedgerReceipt(hash: string, options: RpcOptions = {}): Promise<LedgerReceipt> {
  if (!isHash(hash)) throw new Error("The transaction reference is invalid.");
  const call = rpc(options);
  const head = await pinChain(call);
  const receipt = await call("eth_getTransactionReceipt", [hash]) as { transactionHash?: unknown; status?: unknown; blockNumber?: unknown; logs?: unknown } | null;
  if (!receipt) throw new Error("This transaction is not yet available on X Layer Testnet. Try refreshing later.");
  if (String(receipt.transactionHash).toLowerCase() !== hash.toLowerCase() || quantity(receipt.status) !== 1) throw new Error("This transaction has no successful share-ledger result.");
  const block = quantity(receipt.blockNumber);
  if (block > head) throw new Error("The transaction block has not been confirmed by this read.");
  const transfers = ledgerTransfers(receipt.logs, block, block);
  if (!transfers.length || transfers.some(row => row.hash !== hash.toLowerCase())) throw new Error("This transaction contains no matching share-ledger transfers.");
  return { hash: hash.toLowerCase(), block, blockTime: await blockTime(call, block), transfers };
}
