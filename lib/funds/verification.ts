import type { FundDetail } from "./api";
import { otherFund } from "./catalog";
import type { Composition } from "../xstocks/basket";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { PROOF_DEPLOYMENT, verifyFundComposition } from "../xstocks/proof";

/** A record older than this is not current: the fund and the lending market refuse it too. */
export const NAV_MAX_AGE_MS = 60 * 60_000;

export type FundVerification =
  | { result: "matched"; detail: string; record: OnchainNav; composition: Composition; stale?: true }
  | { result: "failed" | "unavailable" | "checking"; detail: string; record?: never; composition?: never; stale?: never };

/** Every verified figure comes from the same record, read under a locally pinned product key. */
export async function verifyFundSnapshot(fund: FundDetail, fundId: string, options: { fetcher?: typeof fetch; now?: number } = {}): Promise<FundVerification> {
  const definition = otherFund(fundId);
  if (!definition || fund.id !== definition.id || fund.productKey.toLowerCase() !== definition.productKey.toLowerCase()) {
    return { result: "failed", detail: "This response belongs to a different fund." };
  }
  const record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, {
    chainId: PROOF_DEPLOYMENT.chainId, productKey: definition.productKey, fetcher: options.fetcher,
  });
  if (!record.effectiveAt) return { result: "unavailable", detail: "No record of this fund is on X Layer yet." };
  const entry = fund.history.find(item => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase());
  if (!entry) {
    const newest = fund.history[0];
    return { result: "unavailable", detail: newest && Date.parse(newest.asOf) > Date.parse(record.effectiveAt)
      ? "This page's newer records are still waiting to be written to X Layer, and the one on X Layer is not among them. Waiting for the next record."
      : "A newer record is on X Layer than this page has. Waiting for the page to refresh." };
  }
  const checks = await verifyFundComposition(entry.canonical, record, definition.id);
  if (checks.hash.state !== "pass" || checks.nav.state !== "pass" || !checks.composition) {
    return { result: "failed", detail: "The holdings document does not match this fund's record on X Layer." };
  }
  // The publisher stores ISO milliseconds; the registry stores Unix seconds.
  // Require the same second, as the write to the registry does, without rounding forward.
  if (fund.nav?.perShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(fund.nav.asOf) / 1_000) !== Math.floor(Date.parse(record.effectiveAt) / 1_000)) {
    return { result: "failed", detail: "The page's NAV or timestamp differs from the record on X Layer. Waiting for a matching update." };
  }
  const detail = "Your browser read this fund's record on X Layer, hashed its holdings document and recalculated the NAV shown here: they match.";
  // An old record still checks out as what was recorded; it is shown as the last value, marked delayed.
  if ((options.now ?? Date.now()) - Date.parse(record.effectiveAt) > NAV_MAX_AGE_MS) {
    return { result: "matched", stale: true, detail: `${detail} It is the latest record but over an hour old: new records are delayed, so this is the last known value.`, record, composition: checks.composition };
  }
  return { result: "matched", detail, record, composition: checks.composition };
}
