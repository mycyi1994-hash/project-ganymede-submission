/**
 * USTX usage since launch, with the team's and the tests' wallets (lib/xstocks/team-wallets.ts) kept
 * apart, so the figures show what other wallets did. The activity cron carries it forward from the
 * rows its index adds (lib/xstocks/activity-index.ts); the history before 3 October was read once
 * from X Layer Testnet into usage-seed.ts. GET /api/v1/ustx/usage serves it.
 */
import type { ActivityIndex, ActivityKind, MarketActivity } from "./activity";
import { TEAM_WALLETS } from "./team-wallets";
import { USAGE_SEED } from "./usage-seed";

export const STATE_USAGE = "xstocks:usage";

const TRADE_KINDS = new Set<ActivityKind>(["invest", "redeem", "buy", "sell", "arbitrage", "v4Buy", "v4Sell"]);

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
};

const add = (value: string, more: bigint) => (BigInt(value) + more).toString();

/** The usage with `rows` counted: only rows after `usage.toBlock`, up to `toBlock`. */
export function addUsage(usage: Usage, rows: MarketActivity[], toBlock: number): Usage {
  if (toBlock <= usage.toBlock) return usage;
  const next: Usage = { ...usage, toBlock, wallets: { ...usage.wallets }, kinds: { ...usage.kinds }, team: { ...usage.team } };
  for (const row of [...rows].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)) {
    if (row.block <= usage.toBlock || row.block > toBlock) continue;
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
      ? { ...wallet, lastAt: row.at, actions: wallet.actions + 1, volumeMicros: add(wallet.volumeMicros, volume) }
      : { firstAt: row.at, lastAt: row.at, actions: 1, volumeMicros: volume.toString() };
  }
  return next;
}

/** The usage carried forward by the activity index's latest run. */
export const updateUsage = (usage: Usage | null, index: ActivityIndex): Usage => addUsage(usage ?? USAGE_SEED, index.rows, index.toBlock);

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
