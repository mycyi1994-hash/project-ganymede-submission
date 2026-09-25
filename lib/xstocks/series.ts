/**
 * A compact NAV series for the chart, kept apart from publication. The rolling history holds
 * full documents for only the latest twelve publications; this keeps [seconds, NAV] for up to
 * seven days. Older points are recovered from the NavPublished event in each confirmed
 * publication's transaction receipt, a few per cycle.
 */
import { XSTOCKS_PRODUCT } from "./basket";
import { decodeNavPublished } from "./evidence";
import { XSTOCKS_PRODUCT_KEY } from "./onchain";

export const STATE_SERIES = "xstocks:series";
export const STATE_SERIES_CURSOR = "xstocks:series-cursor";
/** Seven days of five-minute publications. */
export const SERIES_LIMIT = 2016;
const BACKFILL_PER_CYCLE = 24;
const DONE = "done";

export type SeriesPoint = [seconds: number, navPerShareMicros: string];
type HistoryEntry = { asOf: string; navPerShareMicros: string; status: string; txHash: string | null };
type SettlementRow = { entityId: string; txHash: string };
export type SeriesRepository = {
  getState(key: string): Promise<{ value: string } | null>;
  setState(key: string, value: string): Promise<void>;
  confirmedNavSettlements?(entityPrefix: string, before: string | null, limit: number): Promise<SettlementRow[]>;
};

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const valid = (point: unknown): point is SeriesPoint => Array.isArray(point) && point.length === 2 && Number.isSafeInteger(point[0]) && typeof point[1] === "string" && /^(0|[1-9]\d{0,30})$/.test(point[1]);

export function parseSeries(value: string | null | undefined): SeriesPoint[] {
  try {
    const parsed = JSON.parse(value ?? "null") as { points?: unknown };
    return Array.isArray(parsed?.points) ? parsed.points.filter(valid) : [];
  } catch { return []; }
}

/** One point per second, oldest first, at most SERIES_LIMIT points. */
export function mergeSeries(existing: SeriesPoint[], added: SeriesPoint[]): SeriesPoint[] {
  const bySecond = new Map<number, SeriesPoint>();
  for (const point of [...existing, ...added]) if (valid(point)) bySecond.set(point[0], point);
  return [...bySecond.values()].sort((a, b) => a[0] - b[0]).slice(-SERIES_LIMIT);
}

/**
 * mergeSeries for a stored series (already validated by parseSeries): when it is sorted and every
 * added point is newer than it or already in it unchanged, the new points are appended without
 * rebuilding and re-sorting the whole series, so the record's CPU time stays small.
 */
export function appendSeries(stored: SeriesPoint[], added: SeriesPoint[]): SeriesPoint[] {
  const last = stored.length ? stored[stored.length - 1][0] : -Infinity;
  for (let index = 1; index < stored.length; index += 1) if (stored[index - 1][0] >= stored[index][0]) return mergeSeries(stored, added);
  const newer = new Map<number, SeriesPoint>();
  for (const point of added) {
    if (!valid(point)) continue;
    if (point[0] > last) { newer.set(point[0], point); continue; }
    let index = stored.length - 1;
    while (index >= 0 && stored[index][0] > point[0]) index -= 1;
    if (index < 0 || stored[index][0] !== point[0] || stored[index][1] !== point[1]) return mergeSeries(stored, added);
  }
  if (newer.size === 0) return stored.slice(-SERIES_LIMIT);
  return [...stored, ...[...newer.values()].sort((a, b) => a[0] - b[0])].slice(-SERIES_LIMIT);
}

/** Evenly spaced points for the public response, always keeping the newest. */
export function downsampleSeries(points: SeriesPoint[], max = 300): SeriesPoint[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / (max - 1));
  const kept = points.filter((_, index) => index % stride === 0);
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept;
}

async function receiptPoint(rpcUrl: string, registry: string, txHash: string, fetcher: typeof fetch): Promise<SeriesPoint | null> {
  const response = await fetcher(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }) });
  if (!response.ok) throw new Error(`receipt RPC ${response.status}`);
  const payload = await response.json() as { result?: { status?: string; logs?: { address: string; topics: string[]; data: string }[] } | null; error?: unknown };
  if (payload.error !== undefined) throw new Error("receipt RPC error");
  const receipt = payload.result;
  if (!receipt || receipt.status !== "0x1") return null;
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    const event = decodeNavPublished(log);
    if (event && event.productKey === XSTOCKS_PRODUCT_KEY) return [seconds(event.effectiveAt), event.navPerShareMicros];
  }
  return null;
}

/**
 * Adds the confirmed publications in the rolling history, then walks back through older
 * confirmed publications. A receipt that cannot be read stops this cycle's walk so it is
 * retried; a receipt without a matching event is skipped.
 */
export async function updateNavSeries(repo: SeriesRepository, options: { rpcUrl: string; registry: string | undefined; historyKey: string; fetcher?: typeof fetch }): Promise<{ points: number; backfilled: number }> {
  const history = JSON.parse((await repo.getState(options.historyKey))?.value ?? "[]") as HistoryEntry[];
  const stored = parseSeries((await repo.getState(STATE_SERIES))?.value);
  let series = appendSeries(stored, history.filter(entry => entry.status === "confirmed" && entry.txHash).map(entry => [seconds(entry.asOf), entry.navPerShareMicros] as SeriesPoint));
  let backfilled = 0;
  const cursorState = (await repo.getState(STATE_SERIES_CURSOR))?.value ?? null;
  if (cursorState !== DONE && repo.confirmedNavSettlements && options.registry && /^0x[0-9a-f]{40}$/i.test(options.registry)) {
    const rows = await repo.confirmedNavSettlements(`${XSTOCKS_PRODUCT.id}:`, cursorState, BACKFILL_PER_CYCLE);
    let cursor = cursorState;
    const recovered: SeriesPoint[] = [];
    for (const row of rows) {
      try {
        const point = await receiptPoint(options.rpcUrl, options.registry, row.txHash, options.fetcher ?? fetch);
        if (point) recovered.push(point);
      } catch { break; }
      cursor = row.entityId;
      backfilled += 1;
    }
    series = mergeSeries(series, recovered);
    const next = rows.length < BACKFILL_PER_CYCLE && backfilled === rows.length ? DONE : cursor;
    if (next !== cursorState && next !== null) await repo.setState(STATE_SERIES_CURSOR, next);
  }
  if (series.length !== stored.length || series.some((point, index) => point[0] !== stored[index]?.[0])) await repo.setState(STATE_SERIES, JSON.stringify({ v: 1, points: series }));
  return { points: series.length, backfilled };
}
