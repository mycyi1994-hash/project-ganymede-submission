/**
 * The USTX pools' mid prices against the NAV, as GET /api/v1/ustx/pools serves them: the
 * constant-product pool, the Uniswap v4 pool held at the NAV and the range pool, each against the NAV
 * its own read carries. A pool without a price or a usable NAV (a record over an hour old) has no gap.
 */
export type PoolGapId = "ustx-dusd" | "ustx-dusd-v4" | "ustx-dusd-range";
export type PoolGap = { id: PoolGapId; name: string; short: string; priceMicros: bigint; navMicros: bigint; premiumPpm: bigint };
/** One pool as read at one block, with its gap, or null without a price or a usable NAV. */
export type PoolRead = { id: PoolGapId; block: number; gap: PoolGap | null };

const POOLS: { id: PoolGapId; name: string; short: string }[] = [
  { id: "ustx-dusd", name: "Constant product", short: "Classic" },
  { id: "ustx-dusd-v4", name: "Uniswap v4, held at the NAV", short: "v4" },
  { id: "ustx-dusd-range", name: "Range pool", short: "Range" },
];

const micros = (value: unknown): bigint | null => typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;

/** The pool `id` read at `block`: its price against `navMicros`, no gap without both. */
export function poolRead(id: PoolGapId, block: number, priceMicros: bigint | null, navMicros: bigint | null): PoolRead {
  const pool = POOLS.find(item => item.id === id)!;
  const gap = priceMicros === null || navMicros === null || priceMicros <= 0n || navMicros <= 0n ? null
    : { ...pool, priceMicros, navMicros, premiumPpm: (priceMicros - navMicros) * 1_000_000n / navMicros };
  return { id, block, gap };
}

/** Each known pool in a pools API body, in the API's order. */
export function poolReads(body: unknown): PoolRead[] {
  const pools = body && typeof body === "object" && Array.isArray((body as { pools?: unknown }).pools) ? (body as { pools: unknown[] }).pools : [];
  return POOLS.flatMap(pool => {
    const read = pools.find(item => Boolean(item) && typeof item === "object" && (item as { id?: unknown }).id === pool.id) as { block?: unknown; priceMicros?: unknown; navMicros?: unknown } | undefined;
    if (!read) return [];
    return [poolRead(pool.id, Number.isSafeInteger(read.block) ? read.block as number : 0, micros(read.priceMicros), micros(read.navMicros))];
  });
}

/** `held` with each pool replaced by its read in `next` at the same or a later block: a later read without a gap removes the gap. */
export function newestReads(held: PoolRead[], next: PoolRead[]): PoolRead[] {
  return POOLS.flatMap(pool => {
    const before = held.find(read => read.id === pool.id);
    const after = next.find(read => read.id === pool.id);
    const newest = before && after ? after.block >= before.block ? after : before : before ?? after;
    return newest ? [newest] : [];
  });
}

/**
 * `held` with a page's own read of one pool in place of the one held, when it is at a later block and
 * against the same NAV, or nothing is held: after a new NAV record it waits for the API's read of
 * every pool, so the pools shown together are always measured against one NAV.
 */
export function withPoolRead(held: PoolRead[], read: PoolRead): PoolRead[] {
  const before = held.find(item => item.id === read.id);
  if (before && (before.block >= read.block || before.gap?.navMicros !== read.gap?.navMicros)) return held;
  return newestReads(held, [read]);
}

export const gapsOf = (reads: PoolRead[]): PoolGap[] => reads.flatMap(read => read.gap ? [read.gap] : []);

export const poolGaps = (body: unknown): PoolGap[] => gapsOf(poolReads(body));

/** "−0.25%" or "+0.01%", truncated to the basis point, so "0.00%", unsigned, under one. */
export function signedGap(premiumPpm: bigint): string {
  const size = premiumPpm < 0n ? -premiumPpm : premiumPpm;
  if (size < 100n) return "0.00%";
  return `${premiumPpm < 0n ? "−" : "+"}${size / 10_000n}.${(size % 10_000n / 100n).toString().padStart(2, "0")}%`;
}
