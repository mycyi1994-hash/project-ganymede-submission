/** Reads shared by the fund API and order routes. Nothing here writes. */
import type { EngineRepository } from "../engine/repository";
import { SettlementClient } from "../engine/settlement";
import { engineEnv } from "../engine/api-helpers";
import { DemoOrderError } from "../demo/ledger";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { STATE_CONFIRMED } from "../xstocks/cycle";
import { downsampleSeries, parseSeries, STATE_SERIES, type SeriesPoint } from "../xstocks/series";
import type { Publication, RebalanceEvidence } from "../xstocks/cycle";
import { FUNDS, type FundDefinition, universeToken } from "./catalog";
import { fundStateKey, type FundLatest } from "./cycle";
import { FundDemoLedger, type FundDb } from "./demo";

const parse = <T>(value: string | undefined | null, empty: T): T => { try { return value ? JSON.parse(value) as T : empty; } catch { return empty; } };

export type FundSummary = {
  id: string; ticker: string; name: string; theme: string; description: string; href: string; productKey: string;
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
  // A week of records, thinned for a sparkline.
  const weekAgo = Date.now() / 1000 - 7 * 86_400;
  const series = downsampleSeries(raw.filter(([at]) => at >= weekAgo), seriesPoints);
  const first = series[0] ? Number(series[0][1]) : null;
  const latest = record ? Number(record.navPerShareMicros) : null;
  return {
    id: fund.id, ticker: fund.ticker, name: fund.name, theme: fund.theme, description: fund.description, href: fund.href, productKey: fund.productKey, onchainShares: fund.onchainShares,
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
  demo: { sharesMicros: string; investors: number };
};

export async function fundDetail(repo: EngineRepository, fund: FundDefinition): Promise<FundDetail> {
  const [summary, latest, history, rebalance, demo] = await Promise.all([
    fundSummary(repo, fund, 300),
    repo.getState(fundStateKey(fund.id, "latest")),
    repo.getState(fundStateKey(fund.id, "history")),
    repo.getState(fundStateKey(fund.id, "rebalance")),
    new FundDemoLedger(repo.db as unknown as FundDb).totals(fund.id),
  ]);
  return { ...summary, latest: parse<FundLatest | null>(latest?.value, null), history: parse<Publication[]>(history?.value, []), rebalance: parse<RebalanceEvidence | null>(rebalance?.value, null), demo };
}

/** The fund's latest record on X Layer, read directly, for a demo order to fill at. */
export async function fundLatestRecord(fund: FundDefinition): Promise<OnchainNav> {
  const env = engineEnv();
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new DemoOrderError("The NAV registry is not configured.", 503, "nav_unavailable");
  const settlement = new SettlementClient(env);
  try {
    return await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId, productKey: fund.productKey });
  } catch (error) {
    console.error("Fund order NAV read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    throw new DemoOrderError("The NAV record on X Layer could not be read. Try again in a moment.", 503, "nav_unavailable");
  }
}
