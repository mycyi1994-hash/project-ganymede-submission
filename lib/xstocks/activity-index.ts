/**
 * The scheduled job that keeps USTX market activity (lib/xstocks/activity.ts) for the USTX page and
 * GET /api/v1/ustx/activity. It runs on a cron of its own (worker/index.ts), so its requests and any
 * failure stay apart from the cycle that records the NAV.
 */
import { EngineRepository } from "../engine/repository";
import type { EngineEnv } from "../engine/types";
import { fundRpc, type Rpc } from "./fund";
import { parseActivityIndex, serializeActivityIndex, updateActivityIndex } from "./activity";

export const STATE_MARKET_ACTIVITY = "xstocks:market-activity";
/** Four minutes past each five-minute mark: after the NAV record at the mark and the keeper at three past. */
export const ACTIVITY_CRON = "4-59/5 * * * *";

export async function runActivityIndex(env: Pick<EngineEnv, "DB">, options: { rpc?: Rpc } = {}): Promise<{ fromBlock: number; toBlock: number; rows: number }> {
  const repo = new EngineRepository(env.DB);
  const index = parseActivityIndex((await repo.getState(STATE_MARKET_ACTIVITY))?.value);
  const next = await updateActivityIndex(index, options.rpc ?? fundRpc({ signal: AbortSignal.timeout(120_000) }));
  await repo.setState(STATE_MARKET_ACTIVITY, serializeActivityIndex(next));
  return { fromBlock: next.fromBlock, toBlock: next.toBlock, rows: next.rows.length };
}
