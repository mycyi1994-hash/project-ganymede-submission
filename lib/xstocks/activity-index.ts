/**
 * The scheduled job that keeps USTX market activity (lib/xstocks/activity.ts) for the USTX page and
 * GET /api/v1/ustx/activity, and the pools' results for their liquidity providers
 * (lib/xstocks/lp-markout.ts) for Pools and GET /api/v1/ustx/pools, and usage since launch
 * (lib/xstocks/usage.ts) for GET /api/v1/ustx/usage. It runs on a cron of its own
 * (worker/index.ts), so its requests and any failure stay apart from the cycle that records the NAV.
 */
import { EngineRepository } from "../engine/repository";
import type { EngineEnv } from "../engine/types";
import { fundRpc, type Rpc } from "./fund";
import { parseActivityIndex, serializeActivityIndex, updateActivityIndex } from "./activity";
import { parseLpMarkout, serializeLpMarkout, updateLpMarkout } from "./lp-markout";
import { STATE_USAGE, parseUsage, updateUsage } from "./usage";

export const STATE_MARKET_ACTIVITY = "xstocks:market-activity";
export const STATE_LP_MARKOUT = "xstocks:lp-markout";
/** Four minutes past each five-minute mark: after the NAV record at the mark and the keeper at three past. */
export const ACTIVITY_CRON = "4-59/5 * * * *";

export async function runActivityIndex(env: Pick<EngineEnv, "DB">, options: { rpc?: Rpc } = {}): Promise<{ fromBlock: number; toBlock: number; rows: number }> {
  const repo = new EngineRepository(env.DB);
  const index = parseActivityIndex((await repo.getState(STATE_MARKET_ACTIVITY))?.value);
  const next = await updateActivityIndex(index, options.rpc ?? fundRpc({ signal: AbortSignal.timeout(120_000) }));
  // Usage since launch (lib/xstocks/usage.ts) follows the rows the index has just added. It is kept
  // first: its correction of the range pool's arbitrage reads the rows stored before this run read
  // them again, and a run that stops before the index is kept reads them again next time.
  await repo.setState(STATE_USAGE, JSON.stringify(updateUsage(parseUsage((await repo.getState(STATE_USAGE))?.value), next, index?.rows ?? [])));
  await repo.setState(STATE_MARKET_ACTIVITY, serializeActivityIndex(next));
  return { fromBlock: next.fromBlock, toBlock: next.toBlock, rows: next.rows.length };
}

/** The pools' results for their providers, carried forward by the blocks since the last run. */
export async function runLpMarkout(env: Pick<EngineEnv, "DB">, options: { rpc?: Rpc } = {}): Promise<{ toBlock: number; navRecords: number }> {
  const repo = new EngineRepository(env.DB);
  const markout = parseLpMarkout((await repo.getState(STATE_LP_MARKOUT))?.value);
  const next = await updateLpMarkout(markout, options.rpc ?? fundRpc({ signal: AbortSignal.timeout(120_000) }));
  await repo.setState(STATE_LP_MARKOUT, serializeLpMarkout(next));
  return { toBlock: next.toBlock, navRecords: next.navRecords };
}
