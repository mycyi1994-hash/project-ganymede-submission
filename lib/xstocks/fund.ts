/**
 * Wallet investing in USTX on X Layer Testnet. GanymedeBasketFund issues USTX when a wallet
 * invests demo dollars at the NAV recorded in the registry, and redeems at that NAV;
 * GanymedeDemoDollar (dUSD) has no value. Addresses are pinned to
 * onchain/deployments/xlayer-testnet.json and never accepted from an API response.
 * Selectors are precomputed because the app bundle carries no keccak; tests/fund.test.mjs
 * pins them against the compiled contracts.
 */
import { DEFAULT_SETTLEMENT_CHAIN } from "../chains";

export const FUND_DEPLOYMENT = {
  ...DEFAULT_SETTLEMENT_CHAIN,
  fund: "0x77eaeba1366bde7818da12d3cbdbea0a2ee97596",
  dollar: "0xf07535080f74e8b0f571e58dfa600f47e72ea9bf",
  // GanymedeNavFeed: the same registry record in the Chainlink AggregatorV3Interface, for other contracts.
  feed: "0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8",
  // GanymedeUstxPool (the USTX/dUSD market) and GanymedeNavArbitrage, which closes its gap to the NAV.
  pool: "0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1",
  arbitrage: "0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9",
  faucetUrl: "https://web3.okx.com/xlayer/faucet",
} as const;

export const FUND_MIN_INVESTMENT_MICROS = 10_000_000n;
export const FUND_CLAIM_MICROS = 10_000_000_000n;
/** Price tolerance for the minimum-output limit: 1%, well above a five-minute NAV move. */
export const FUND_SLIPPAGE_BPS = 100n;

export const FUND_SELECTORS = {
  claim: "0x4e71d92d",
  approve: "0x095ea7b3",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  nextClaimAt: "0x11a163e9",
  invest: "0xd87aa643",
  redeem: "0x7cbc2373",
  totalSupply: "0x18160ddd",
  investorCount: "0xd7e64c00",
  currentNav: "0xc5c25216",
} as const;

export const POOL_SELECTORS = {
  getReserves: "0x0902f1ac",
} as const;

export const FUND_EVENTS = {
  invested: "0x67bdca1ea1476f51b861369ec435902e65ace4e0b24955f5c21a7293fd053bf0",
  redeemed: "0x8b21d3b09c941202aae6703f703103df5365b7988b1c3e28674cf965bd8205f1",
} as const;

/** Custom errors of both contracts, by selector, in the words a customer needs. */
export const FUND_ERRORS: Record<string, string> = {
  "0x854f3dd0": "You already received demo dollars in the last 24 hours.",
  "0x860b82a9": "The minimum order is $10.",
  "0x27053676": "No NAV has been recorded yet. Try again in a few minutes.",
  "0x220d4d06": "The latest NAV record is over an hour old. Orders reopen with the next record.",
  "0x8199f5f3": "The NAV changed before your order was confirmed. Review the order again.",
  "0xf4d678b8": "Your balance is too low for this order.",
  "0x13be252b": "Approve the demo dollars before investing.",
  "0xab35696f": "Orders are paused right now.",
  "0x2c5211c6": "Enter an amount greater than zero.",
};

export type TransactionCall = { to: string; data: string };
const word = (value: bigint) => {
  if (value < 0n || value >= 1n << 256n) throw new Error("Amount out of range.");
  return value.toString(16).padStart(64, "0");
};
const addressWord = (address: string) => {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("Invalid address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
};

export const fundCalls = {
  claim: (): TransactionCall => ({ to: FUND_DEPLOYMENT.dollar, data: FUND_SELECTORS.claim }),
  approve: (dollarsMicros: bigint): TransactionCall => ({ to: FUND_DEPLOYMENT.dollar, data: `${FUND_SELECTORS.approve}${addressWord(FUND_DEPLOYMENT.fund)}${word(dollarsMicros)}` }),
  invest: (dollarsMicros: bigint, minSharesMicros: bigint): TransactionCall => ({ to: FUND_DEPLOYMENT.fund, data: `${FUND_SELECTORS.invest}${word(dollarsMicros)}${word(minSharesMicros)}` }),
  redeem: (sharesMicros: bigint, minDollarsMicros: bigint): TransactionCall => ({ to: FUND_DEPLOYMENT.fund, data: `${FUND_SELECTORS.redeem}${word(sharesMicros)}${word(minDollarsMicros)}` }),
};

/** The contract's own arithmetic: shares = dollars × 10^6 / NAV, dollars = shares × NAV / 10^6, rounded down. */
export const sharesFor = (dollarsMicros: bigint, navMicros: bigint) => navMicros > 0n ? dollarsMicros * 1_000_000n / navMicros : 0n;
export const dollarsFor = (sharesMicros: bigint, navMicros: bigint) => sharesMicros * navMicros / 1_000_000n;
export const withSlippage = (quote: bigint) => quote * (10_000n - FUND_SLIPPAGE_BPS) / 10_000n;

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
type RpcOptions = { fetcher?: typeof fetch; signal?: AbortSignal };

export function fundRpc(options: RpcOptions = {}): Rpc {
  let id = 0;
  return async (method, params) => {
    const requestId = ++id;
    const response = await (options.fetcher ?? fetch)(FUND_DEPLOYMENT.rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
    if (!response.ok) throw new Error("X Layer Testnet is temporarily unavailable.");
    const body = await response.json() as { id?: unknown; result?: unknown; error?: { message?: unknown; data?: unknown } };
    if (body.error) throw Object.assign(new Error(typeof body.error.message === "string" ? body.error.message : "X Layer Testnet rejected the request."), { data: body.error.data });
    if (body.id !== requestId || body.result === undefined) throw new Error("X Layer Testnet returned an invalid response.");
    return body.result;
  };
}

const hexBlock = (block: number) => `0x${block.toString(16)}`;
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error("X Layer Testnet returned an invalid value.");
  return BigInt(value);
}
function words(value: unknown, count: number): bigint[] {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value) || value.length < 2 + 64 * count) throw new Error("X Layer Testnet returned an invalid value.");
  return Array.from({ length: count }, (_, index) => BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`));
}
const call = (rpc: Rpc, to: string, data: string, block: string) => rpc("eth_call", [{ to, data }, block]);

/**
 * Runs `read` at `block`, retrying while the load-balanced public RPC answers from a node
 * that has not seen that block yet. Reverts are returned at once.
 */
async function atBlock<T>(read: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await read(); } catch (error) {
      const name = (error as { name?: unknown })?.name;
      if (attempt >= attempts || isRevert(error) || name === "AbortError" || name === "TimeoutError") throw error;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
}

export type FundNav = { navMicros: bigint; effectiveAt: string } | { navMicros: null; reason: string };
export type FundAccount = {
  block: number;
  gasWei: bigint;
  dollarsMicros: bigint;
  allowanceMicros: bigint;
  nextClaimAt: number;
  sharesMicros: bigint;
  nav: FundNav;
};

async function readNav(rpc: Rpc, block: string): Promise<FundNav> {
  try {
    const [nav, effectiveAt] = words(await call(rpc, FUND_DEPLOYMENT.fund, FUND_SELECTORS.currentNav, block), 2);
    return { navMicros: nav, effectiveAt: new Date(Number(effectiveAt) * 1000).toISOString() };
  } catch (error) {
    if (!isRevert(error)) throw error;
    return { navMicros: null, reason: fundErrorMessage(error) };
  }
}

/**
 * The block to read at: the latest the RPC reports, but never below `minBlock`, the newest block
 * this page has seen (a receipt's), so a lagging node cannot show balances from before it.
 */
async function readBlock(rpc: Rpc, minBlock = 0): Promise<number> {
  if (quantity(await rpc("eth_chainId", [])) !== BigInt(FUND_DEPLOYMENT.chainId)) throw new Error("The network does not match X Layer Testnet.");
  return Math.max(Number(quantity(await rpc("eth_blockNumber", []))), minBlock);
}

/** Everything the order panel needs for one wallet, read at one block. */
export async function readFundAccount(account: string, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<FundAccount> {
  const rpc = options.rpc ?? fundRpc();
  const owner = addressWord(account);
  const block = await readBlock(rpc, options.minBlock);
  const tag = hexBlock(block);
  return atBlock(async () => {
    const [gas, dollars, allowance, nextClaim, shares, nav] = await Promise.all([
      rpc("eth_getBalance", [account, tag]).then(quantity),
      call(rpc, FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.balanceOf}${owner}`, tag).then(value => words(value, 1)[0]),
      call(rpc, FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.allowance}${owner}${addressWord(FUND_DEPLOYMENT.fund)}`, tag).then(value => words(value, 1)[0]),
      call(rpc, FUND_DEPLOYMENT.dollar, `${FUND_SELECTORS.nextClaimAt}${owner}`, tag).then(value => words(value, 1)[0]),
      call(rpc, FUND_DEPLOYMENT.fund, `${FUND_SELECTORS.balanceOf}${owner}`, tag).then(value => words(value, 1)[0]),
      readNav(rpc, tag),
    ]);
    return { block, gasWei: gas, dollarsMicros: dollars, allowanceMicros: allowance, nextClaimAt: Number(nextClaim), sharesMicros: shares, nav };
  });
}

export type PoolMarket = {
  block: number;
  sharesMicros: bigint;
  dollarsMicros: bigint;
  /** Mid price in demo-dollar micros per USTX, before the 0.3% fee; 0 while the pool is empty. */
  priceMicros: bigint;
  navMicros: bigint | null;
  /** The mid price against the NAV in parts per million (-2700 is 0.27% below); null without both. */
  premiumPpm: bigint | null;
};

/** The USTX pool's reserves, mid price and gap to the NAV, read at one block. */
export async function readPoolMarket(options: { rpc?: Rpc } = {}): Promise<PoolMarket> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc);
  const tag = hexBlock(block);
  return atBlock(async () => {
    const [[shares, dollars], nav] = await Promise.all([
      call(rpc, FUND_DEPLOYMENT.pool, POOL_SELECTORS.getReserves, tag).then(value => words(value, 2)),
      readNav(rpc, tag),
    ]);
    const priceMicros = shares > 0n ? dollars * 1_000_000n / shares : 0n;
    const premiumPpm = nav.navMicros && priceMicros > 0n ? (priceMicros - nav.navMicros) * 1_000_000n / nav.navMicros : null;
    return { block, sharesMicros: shares, dollarsMicros: dollars, priceMicros, navMicros: nav.navMicros, premiumPpm };
  });
}

/** "0.27% below NAV", "0.15% above NAV", or "at the NAV" within half a basis point. */
export function describePremium(premiumPpm: bigint): string {
  const size = premiumPpm < 0n ? -premiumPpm : premiumPpm;
  if (size < 50n) return "at the NAV";
  const percent = `${size / 10_000n}.${(size % 10_000n / 100n).toString().padStart(2, "0")}%`;
  return `${percent} ${premiumPpm < 0n ? "below" : "above"} NAV`;
}

export type FundTotals = { block: number; sharesMicros: bigint; investors: number };

/** Engine state key where each cycle keeps the last wallet totals it read, as a fallback. */
export const STATE_WALLET_SHARES = "xstocks:wallet-shares";
export type StoredWalletTotals = { sharesMicros: string; investors: number; block: number; readAt: string };

export function parseStoredWalletTotals(value: string | null | undefined): StoredWalletTotals | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as StoredWalletTotals;
    return /^\d{1,40}$/.test(stored.sharesMicros) && Number.isSafeInteger(stored.investors) && stored.investors >= 0 && Number.isSafeInteger(stored.block) && typeof stored.readAt === "string" ? stored : null;
  } catch { return null; }
}

/** USTX issued on chain and the number of wallets holding it, read at one block. */
export async function readFundTotals(options: { rpc?: Rpc } = {}): Promise<FundTotals> {
  const rpc = options.rpc ?? fundRpc();
  const block = await readBlock(rpc);
  const tag = hexBlock(block);
  return atBlock(async () => {
    const [supply, investors] = await Promise.all([
      call(rpc, FUND_DEPLOYMENT.fund, FUND_SELECTORS.totalSupply, tag).then(value => words(value, 1)[0]),
      call(rpc, FUND_DEPLOYMENT.fund, FUND_SELECTORS.investorCount, tag).then(value => words(value, 1)[0]),
    ]);
    if (investors > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("X Layer Testnet returned an invalid value.");
    return { block, sharesMicros: supply, investors: Number(investors) };
  });
}

/** Dry-runs a call from `from`, so a revert shows its reason before the wallet opens. */
export async function simulateFundCall(from: string, request: TransactionCall, options: { rpc?: Rpc; minBlock?: number } = {}): Promise<void> {
  const rpc = options.rpc ?? fundRpc();
  addressWord(from);
  const tag = hexBlock(await readBlock(rpc, options.minBlock));
  await atBlock(() => rpc("eth_call", [{ from, to: request.to, data: request.data }, tag]));
}

export type FundReceipt = { hash: string; block: number; status: "success" | "reverted"; logs: Array<{ address: string; topics: string[]; data: string }> };

/** Polls the public RPC until the transaction is mined. */
export async function waitForFundReceipt(hash: string, options: { rpc?: Rpc; timeoutMs?: number; intervalMs?: number } = {}): Promise<FundReceipt> {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("The wallet returned an invalid transaction hash.");
  const rpc = options.rpc ?? fundRpc();
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  for (;;) {
    let receipt: Record<string, unknown> | null = null;
    try { receipt = await rpc("eth_getTransactionReceipt", [hash]) as Record<string, unknown> | null; } catch { /* A lagging node or a timeout: poll again. */ }
    if (receipt) {
      const logs = Array.isArray(receipt.logs) ? receipt.logs as Array<{ address: string; topics: string[]; data: string }> : [];
      return { hash: hash.toLowerCase(), block: Number(quantity(receipt.blockNumber)), status: receipt.status === "0x1" ? "success" : "reverted", logs };
    }
    if (Date.now() > deadline) throw new Error("X Layer Testnet has not confirmed the transaction yet. Check it on the OKX explorer.");
    await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 1_500));
  }
}

export type FundFill = { side: "invest" | "redeem"; investor: string; dollarsMicros: bigint; sharesMicros: bigint; navMicros: bigint; navEffectiveAt: string };

/** The Invested or Redeemed event the fund emitted in a receipt. */
export function fundFill(receipt: FundReceipt): FundFill | null {
  for (const log of receipt.logs) {
    if (typeof log.address !== "string" || log.address.toLowerCase() !== FUND_DEPLOYMENT.fund) continue;
    const topic = log.topics?.[0]?.toLowerCase();
    if (topic !== FUND_EVENTS.invested && topic !== FUND_EVENTS.redeemed) continue;
    const investor = `0x${String(log.topics[1]).slice(-40)}`.toLowerCase();
    const [first, second, nav, effectiveAt] = words(log.data, 4);
    return topic === FUND_EVENTS.invested
      ? { side: "invest", investor, dollarsMicros: first, sharesMicros: second, navMicros: nav, navEffectiveAt: new Date(Number(effectiveAt) * 1000).toISOString() }
      : { side: "redeem", investor, sharesMicros: first, dollarsMicros: second, navMicros: nav, navEffectiveAt: new Date(Number(effectiveAt) * 1000).toISOString() };
  }
  return null;
}

/** Revert data carried by a wallet or RPC error, wherever the provider put it. */
function revertData(error: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (!value || seen.has(value)) return null;
    if (typeof value === "string") return /^0x[0-9a-f]{8}/i.test(value) ? value : null;
    if (typeof value !== "object") return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["data", "error", "cause", "originalError"]) { const found = visit(record[key]); if (found) return found; }
    if (typeof record.message === "string") { const match = /0x[0-9a-f]{8}(?:[0-9a-f]{64})*/i.exec(record.message); if (match && /revert/i.test(record.message)) return match[0]; }
    return null;
  };
  return visit(error);
}

export function isRevert(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return Boolean(revertData(error)) || /execution reverted|revert/i.test(message);
}

/** A customer-facing reason for a failed wallet request, transaction or read. */
export function fundErrorMessage(error: unknown): string {
  const record = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  if (record.code === 4001 || /user (rejected|denied|cancel)/i.test(message)) return "You cancelled the request in your wallet.";
  if (/insufficient funds|gas required exceeds|not enough (okb|gas)/i.test(message)) return "You need test OKB on X Layer Testnet to pay the network fee.";
  const data = revertData(error);
  if (data) return FUND_ERRORS[data.slice(0, 10).toLowerCase()] ?? "The contract rejected this order.";
  if (/revert/i.test(message)) return "The contract rejected this order.";
  return message && message.length < 160 ? message : "The request could not be completed. Check your wallet and try again.";
}

/** EIP-3085 parameters for wallet_addEthereumChain. */
export const FUND_WALLET_CHAIN = {
  chainId: `0x${FUND_DEPLOYMENT.chainId.toString(16)}`,
  chainName: FUND_DEPLOYMENT.name,
  rpcUrls: [FUND_DEPLOYMENT.rpcUrl],
  nativeCurrency: FUND_DEPLOYMENT.nativeCurrency,
  blockExplorerUrls: [FUND_DEPLOYMENT.explorerUrl],
};

export const fundExplorer = {
  tx: (hash: string) => `${FUND_DEPLOYMENT.explorerUrl}/tx/${hash}`,
  address: (address: string) => `${FUND_DEPLOYMENT.explorerUrl}/address/${address}`,
  token: (address: string) => `${FUND_DEPLOYMENT.explorerUrl}/token/${address}`,
};
