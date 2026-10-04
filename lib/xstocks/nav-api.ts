/**
 * What GET /api/v1/ustx serves, read from X Layer and the engine state: the latest USTX record in the
 * registry, the transaction and calculation time this server logged for it, and the shares now in
 * wallets and in demo balances. The once-a-minute cron stores it as a snapshot (see ./snapshot), so
 * the public API reads the database instead of X Layer for each request.
 */
import { DemoLedger, type DemoFund } from "../demo/ledger";
import { walletTotals, type WalletTotals } from "../demo/api";
import { EngineRepository } from "../engine/repository";
import { SettlementClient } from "../engine/settlement";
import type { EngineEnv } from "../engine/types";
import { STATE_CONFIRMED, STATE_HISTORY, type Publication } from "./cycle";
import { readLatestNav, type OnchainNav } from "./onchain";
import { snapshotOrRead, storeSnapshot, type Snapshot } from "./snapshot";

export const STATE_NAV_SNAPSHOT = "xstocks:nav-snapshot";
/** A record changes every five minutes; a snapshot this recent is served as it is. */
export const NAV_SNAPSHOT_FRESH_MS = 90_000;

export type NavRead = {
  record: OnchainNav & { effectiveAt: string };
  transactionHash: string | null;
  calculatedAt: string | null;
  demo: DemoFund | null;
  wallets: WalletTotals | null;
};

export class NavUnavailable extends Error {}

export async function readNav(env: EngineEnv): Promise<NavRead> {
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new NavUnavailable("The NAV registry is not configured.");
  const settlement = new SettlementClient(env);
  const record = await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId });
  if (!record.effectiveAt) throw new NavUnavailable("No NAV has been recorded yet.");
  // The transaction hash is a convenience from this server's log; the record itself came from the chain.
  let transactionHash: string | null = null;
  let calculatedAt: string | null = null;
  try {
    const repo = new EngineRepository(env.DB);
    const [history, confirmed] = await Promise.all([repo.getState(STATE_HISTORY), repo.getState(STATE_CONFIRMED)]);
    const entries = [...(history ? JSON.parse(history.value) as Publication[] : []), ...(confirmed ? [JSON.parse(confirmed.value) as Publication] : [])];
    const match = entries.find(entry => entry.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof entry.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.txHash));
    transactionHash = match?.txHash ?? null;
    const entry = entries.find(item => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof item.calculatedAt === "string");
    calculatedAt = entry?.calculatedAt ?? null;
  } catch { /* The record stands without it. */ }
  // The count recorded with the NAV covers two kinds of shares; each part is read now, and a part that
  // cannot be read is null rather than a guess.
  const [demo, wallets] = await Promise.all([new DemoLedger(env.DB).fund(new Date()).catch(() => null), walletTotals().catch(() => null)]);
  return { record: record as NavRead["record"], transactionHash, calculatedAt, demo, wallets };
}

/** The cron's job: read the latest record and store it for the public API. */
export async function runNavSnapshot(env: EngineEnv, now: () => number = Date.now): Promise<Snapshot<NavRead>> {
  return storeSnapshot(env.DB, STATE_NAV_SNAPSHOT, await readNav(env), now());
}

/** The record for a public request: see snapshotOrRead. Reads only. */
export function navForRequest(env: EngineEnv, staleMs: number, now: () => number = Date.now) {
  return snapshotOrRead(env.DB, STATE_NAV_SNAPSHOT, () => readNav(env), { freshMs: NAV_SNAPSHOT_FRESH_MS, staleMs, now });
}
