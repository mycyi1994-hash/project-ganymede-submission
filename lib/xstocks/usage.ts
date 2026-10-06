/**
 * USTX usage since launch, with the team's and the tests' wallets (lib/xstocks/team-wallets.ts) kept
 * apart, so the figures show what other wallets did. The activity cron carries it forward from the
 * rows its index adds (lib/xstocks/activity-index.ts); the history before 3 October was read once
 * from X Layer Testnet into usage-seed.ts. GET /api/v1/ustx/usage serves it.
 */
import type { ActivityIndex, ActivityKind, MarketActivity } from "./activity";
import { RANGE_ARBITRAGES } from "./range-liquidity";
import { TEAM_WALLETS } from "./team-wallets";
import { USAGE_SEED } from "./usage-seed";

export const STATE_USAGE = "xstocks:usage";

const TRADE_KINDS = new Set<ActivityKind>(["invest", "redeem", "buy", "sell", "arbitrage", "rangeArbitrage", "v4Buy", "v4Sell"]);

type Wallet = { firstAt: string; lastAt: string; actions: number; volumeMicros: string };
export type Usage = {
  /** Blocks counted, inclusive. */
  fromBlock: number;
  toBlock: number;
  /** Wallets outside the team's, by address. */
  wallets: Record<string, Wallet>;
  /** Actions by kind: all wallets, and wallets outside the team's. */
  kinds: Record<string, { all: number; outside: number }>;
  team: { actions: number; volumeMicros: string };
  /** One-time corrections already applied (LISTED_LATE). */
  migrations?: string[];
};

const add = (value: string, more: bigint) => (BigInt(value) + more).toString();

/** `usage` with each of `rows` counted: by kind, and under its wallet or the team's. */
function countRows(usage: Usage, rows: MarketActivity[]): Usage {
  const next: Usage = { ...usage, wallets: { ...usage.wallets }, kinds: { ...usage.kinds }, team: { ...usage.team } };
  for (const row of [...rows].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)) {
    const volume = TRADE_KINDS.has(row.kind) ? row.dollarsMicros ?? 0n : 0n;
    const team = row.account in TEAM_WALLETS;
    const kind = next.kinds[row.kind] ?? { all: 0, outside: 0 };
    next.kinds[row.kind] = { all: kind.all + 1, outside: kind.outside + (team ? 0 : 1) };
    if (team) {
      next.team = { actions: next.team.actions + 1, volumeMicros: add(next.team.volumeMicros, volume) };
      continue;
    }
    const wallet = next.wallets[row.account];
    next.wallets[row.account] = wallet
      ? { firstAt: row.at < wallet.firstAt ? row.at : wallet.firstAt, lastAt: row.at > wallet.lastAt ? row.at : wallet.lastAt, actions: wallet.actions + 1, volumeMicros: add(wallet.volumeMicros, volume) }
      : { firstAt: row.at, lastAt: row.at, actions: 1, volumeMicros: volume.toString() };
  }
  return next;
}

/** The usage with `rows` counted: only rows after `usage.toBlock`, up to `toBlock`. */
export function addUsage(usage: Usage, rows: MarketActivity[], toBlock: number): Usage {
  if (toBlock <= usage.toBlock) return usage;
  return { ...countRows(usage, rows.filter(row => row.block > usage.toBlock && row.block <= toBlock)), toBlock };
}

/**
 * Load-test wallets 101 to 3,000 began trading on 4 October before they were listed as the team's,
 * and the Worker then running counted 35 of them as outside wallets. Their actions by kind were read
 * from X Layer Testnet for exactly those wallets, blocks 42,648,562 to 42,650,642: 423 actions and
 * $25,977.951319 of trades. The correction moves them to the team's figures once, and only from the
 * state they were read against, where the listed wallets hold exactly those 423 actions.
 */
export const LISTED_LATE = {
  id: "2026-10-04-load-test-wallets",
  wallets: 35,
  actions: 423,
  volumeMicros: 25_977_951_319n,
  kinds: { invest: 40, redeem: 43, deposit: 38, borrow: 69, repay: 69, withdrawCollateral: 72, lend: 32, withdraw: 60 } as Record<string, number>,
};

/** `usage` with the LISTED_LATE correction applied, if it has not been and the state matches. */
export function moveListedLate(usage: Usage): Usage {
  if (usage.migrations?.includes(LISTED_LATE.id)) return usage;
  const listed = Object.entries(usage.wallets).filter(([address]) => address in TEAM_WALLETS);
  const actions = listed.reduce((sum, [, wallet]) => sum + wallet.actions, 0);
  const volume = listed.reduce((sum, [, wallet]) => sum + BigInt(wallet.volumeMicros), 0n);
  const fits = Object.entries(LISTED_LATE.kinds).every(([kind, count]) => (usage.kinds[kind]?.outside ?? 0) >= count);
  if (listed.length !== LISTED_LATE.wallets || actions !== LISTED_LATE.actions || volume !== LISTED_LATE.volumeMicros || !fits) return usage;
  const wallets = Object.fromEntries(Object.entries(usage.wallets).filter(([address]) => !(address in TEAM_WALLETS)));
  const kinds = { ...usage.kinds };
  for (const [kind, count] of Object.entries(LISTED_LATE.kinds)) kinds[kind] = { ...kinds[kind], outside: kinds[kind].outside - count };
  return {
    ...usage, wallets, kinds,
    team: { actions: usage.team.actions + actions, volumeMicros: add(usage.team.volumeMicros, volume) },
    migrations: [...(usage.migrations ?? []), LISTED_LATE.id],
  };
}

/** The correction moveRangeArbitrageOrders records once it has moved any orders. */
export const RANGE_ORDERS_MOVED = "2026-10-06-range-arbitrage-orders";

/**
 * From 5 October GanymedeRangeArbitrage's orders at the fund were counted as a wallet outside the
 * team's: the fund's events name the contract, which the keeper calls. The market activity now folds
 * each into the arbitrage it was part of (lib/xstocks/activity.ts): the caller's, with the dollars it
 * put in. This counts those arbitrages in place of the orders already counted, as if they had been
 * counted so from the start, so later runs, which count only new blocks, never need to: from the
 * orders the index kept before it read their blocks again (`kept`) and the arbitrages it read in their
 * place (`rows`). Only when the orders account for every action and dollar counted under the contract,
 * and each has its arbitrage.
 */
export function moveRangeArbitrageOrders(usage: Usage, kept: MarketActivity[], rows: MarketActivity[]): Usage {
  let next = usage;
  for (const address of RANGE_ARBITRAGES) {
    const wallet = next.wallets[address];
    if (!wallet) continue;
    const orders = kept.filter(row => row.account === address && row.block <= next.toBlock);
    const volume = orders.reduce((sum, row) => sum + (TRADE_KINDS.has(row.kind) ? row.dollarsMicros ?? 0n : 0n), 0n);
    const byKind = new Map<string, number>();
    for (const row of orders) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
    const fits = [...byKind].every(([kind, count]) => (next.kinds[kind]?.outside ?? 0) >= count && (next.kinds[kind]?.all ?? 0) >= count);
    const hashes = new Set(orders.map(row => row.hash));
    const arbitrages = rows.filter(row => row.kind === "rangeArbitrage" && hashes.has(row.hash));
    if (orders.length !== wallet.actions || volume.toString() !== wallet.volumeMicros || !fits || arbitrages.length !== orders.length) continue;
    const wallets = Object.fromEntries(Object.entries(next.wallets).filter(([other]) => other !== address));
    const kinds = { ...next.kinds };
    for (const [kind, count] of byKind) kinds[kind] = { all: kinds[kind].all - count, outside: kinds[kind].outside - count };
    next = countRows({
      ...next, wallets, kinds,
      migrations: next.migrations?.includes(RANGE_ORDERS_MOVED) ? next.migrations : [...(next.migrations ?? []), RANGE_ORDERS_MOVED],
    }, arbitrages);
  }
  return next;
}

/**
 * The usage carried forward by the activity index's latest run. `kept` are the rows the index held
 * before the run, which still name the range pool's arbitrage in the orders it reads again.
 */
export const updateUsage = (usage: Usage | null, index: ActivityIndex, kept: MarketActivity[] = []): Usage =>
  addUsage(moveRangeArbitrageOrders(moveListedLate(usage ?? USAGE_SEED), kept, index.rows), index.rows, index.toBlock);

export function parseUsage(value: unknown): Usage | null {
  if (typeof value !== "string") return null;
  try {
    const usage = JSON.parse(value) as Usage;
    return Number.isInteger(usage.fromBlock) && Number.isInteger(usage.toBlock) && usage.wallets && usage.kinds && usage.team ? usage : null;
  } catch {
    return null;
  }
}

export type UsageSummary = {
  fromBlock: number;
  toBlock: number;
  since: string | null;
  outside: { wallets: number; activeLast7Days: number; actions: number; volumeMicros: string };
  team: { wallets: number; actions: number; volumeMicros: string };
  kinds: Record<string, { all: number; outside: number }>;
};

export function summarizeUsage(usage: Usage, nowMs: number): UsageSummary {
  const wallets = Object.values(usage.wallets);
  const firsts = wallets.map(wallet => wallet.firstAt).sort();
  return {
    fromBlock: usage.fromBlock,
    toBlock: usage.toBlock,
    since: firsts[0] ?? null,
    outside: {
      wallets: wallets.length,
      activeLast7Days: wallets.filter(wallet => Date.parse(wallet.lastAt) >= nowMs - 7 * 86_400_000).length,
      actions: wallets.reduce((sum, wallet) => sum + wallet.actions, 0),
      volumeMicros: wallets.reduce((sum, wallet) => sum + BigInt(wallet.volumeMicros), 0n).toString(),
    },
    team: { wallets: Object.keys(TEAM_WALLETS).length, actions: usage.team.actions, volumeMicros: usage.team.volumeMicros },
    kinds: usage.kinds,
  };
}
