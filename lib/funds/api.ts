/** Reads for the fund API. Nothing here writes. */
import type { EngineRepository } from "../engine/repository";
import { STATE_CONFIRMED, STATE_HISTORY, STATE_LATEST, STATE_REBALANCE } from "../xstocks/cycle";
import { downsampleSeries, parseSeries, STATE_SERIES, type SeriesPoint } from "../xstocks/series";
import type { Publication, RebalanceEvidence } from "../xstocks/cycle";
import { FUNDS, type FundDefinition, type FundKind, universeToken } from "./catalog";
import { fundStateKey, type FundLatest } from "./cycle";
import type { TransitionArchive } from "../income/transitions";

const parse = <T>(value: string | undefined | null, empty: T): T => { try { return value ? JSON.parse(value) as T : empty; } catch { return empty; } };

export type FundSummary = {
  id: string; ticker: string; name: string; theme: string; description: string; href: string; productKey: string;
  /** A basket of xStocks, a covered-call fund or a step-down autocallable note. */
  kind: FundKind;
  onchainShares: boolean;
  holdings: { symbol: string; name: string; kind: "stock" | "etf" }[];
  nav: { perShareMicros: string; asOf: string; txHash: string | null } | null;
  /** Change since the first record shown in the series, in percent. */
  changePercent: number | null;
  series: SeriesPoint[];
};

/** A fund's latest confirmed record and its NAV history, from what the NAV cron stored. */
export async function fundSummary(repo: EngineRepository, fund: FundDefinition, seriesPoints = 120): Promise<FundSummary> {
  const [confirmed, seriesValue] = fund.onchainShares
    ? await Promise.all([repo.getState(STATE_CONFIRMED), repo.getState(STATE_SERIES)])
    : await Promise.all([repo.getState(fundStateKey(fund.id, "confirmed")), repo.getState(fundStateKey(fund.id, "series"))]);
  const record = parse<Publication | null>(confirmed?.value, null);
  const raw = fund.onchainShares ? parseSeries(seriesValue?.value) : parse<SeriesPoint[]>(seriesValue?.value, []);
  // A week of records up to the latest, thinned for a sparkline: while no new record lands, the week
  // and its change stay put instead of sliding past the oldest points.
  const latestAt = raw.length ? Math.max(...raw.map(([at]) => at)) : Date.now() / 1000;
  const weekAgo = latestAt - 7 * 86_400;
  const series = downsampleSeries(raw.filter(([at]) => at >= weekAgo), seriesPoints);
  const first = series[0] ? Number(series[0][1]) : null;
  const latest = record ? Number(record.navPerShareMicros) : null;
  return {
    id: fund.id, ticker: fund.ticker, name: fund.name, theme: fund.theme, description: fund.description, href: fund.href, productKey: fund.productKey, kind: fund.kind ?? "basket", onchainShares: fund.onchainShares,
    holdings: fund.constituents.map((symbol) => { const token = universeToken(symbol)!; return { symbol, name: token.name, kind: token.kind }; }),
    nav: record ? { perShareMicros: record.navPerShareMicros, asOf: record.asOf, txHash: record.txHash } : null,
    changePercent: first && latest ? ((latest - first) / first) * 100 : null,
    series,
  };
}

export const fundSummaries = (repo: EngineRepository) => Promise.all(FUNDS.map((fund) => fundSummary(repo, fund)));

export type FundDetail = FundSummary & {
  latest: FundLatest | null;
  history: Publication[];
  rebalance: RebalanceEvidence | null;
  /** An income product's sales, fixing, knock-in and observations, for tracing its latest record (lib/income/transitions.ts); null for a basket. */
  transitions: TransitionArchive | null;
};

export async function fundDetail(repo: EngineRepository, fund: FundDefinition): Promise<FundDetail> {
  const income = fund.kind === "covered-call" || fund.kind === "autocall";
  // USTX keeps its records under the keys of the first product (lib/xstocks/cycle.ts), the others under their own.
  const keys = fund.onchainShares
    ? { latest: STATE_LATEST, history: STATE_HISTORY, rebalance: STATE_REBALANCE, confirmed: STATE_CONFIRMED }
    : { latest: fundStateKey(fund.id, "latest"), history: fundStateKey(fund.id, "history"), rebalance: fundStateKey(fund.id, "rebalance"), confirmed: fundStateKey(fund.id, "confirmed") };
  const [summary, latest, history, rebalance, transitions, confirmed] = await Promise.all([
    fundSummary(repo, fund, 300),
    repo.getState(keys.latest),
    repo.getState(keys.history),
    repo.getState(keys.rebalance),
    income ? repo.getState(fundStateKey(fund.id, "transitions")) : null,
    repo.getState(keys.confirmed),
  ]);
  // The last confirmed record stays listed with its document, which the browser checks against X
  // Layer, even when newer records still waiting for the chain have filled the rolling list.
  const listed = parse<Publication[]>(history?.value, []);
  const lastConfirmed = parse<Publication | null>(confirmed?.value, null);
  const records = lastConfirmed && !listed.some(entry => entry.holdingsHash.toLowerCase() === lastConfirmed.holdingsHash.toLowerCase()) ? [...listed, lastConfirmed] : listed;
  // USTX's latest state also holds its document and retry time, which the record's API leaves out.
  const stored = parse<(FundLatest & { canonical?: unknown; holdingsHash?: unknown; retryAt?: unknown }) | null>(latest?.value, null);
  const latestRecord: FundLatest | null = stored && {
    evaluatedAt: stored.evaluatedAt, status: stored.status, blockers: stored.blockers, warnings: stored.warnings,
    composition: stored.composition, publication: stored.publication, poolCheck: stored.poolCheck ?? null,
  };
  return {
    ...summary, latest: latestRecord, history: records, rebalance: parse<RebalanceEvidence | null>(rebalance?.value, null),
    transitions: parse<TransitionArchive | null>(transitions?.value, null),
  };
}

