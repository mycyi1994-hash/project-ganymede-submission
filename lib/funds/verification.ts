import type { FundDetail } from "./api";
import { otherFund } from "./catalog";
import type { Composition } from "../xstocks/basket";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { PROOF_DEPLOYMENT, verifyFundComposition } from "../xstocks/proof";
import { DEMO_NAV_MAX_AGE_MS } from "../demo/ledger";

export type FundVerification =
  | { result: "matched"; detail: string; record: OnchainNav; composition: Composition }
  | { result: "failed" | "unavailable" | "checking"; detail: string; record?: never; composition?: never };

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
  if (!entry) return { result: "unavailable", detail: "A newer record is on X Layer than this page has. Waiting for the page to refresh." };
  const checks = await verifyFundComposition(entry.canonical, record, definition.id);
  if (checks.hash.state !== "pass" || checks.nav.state !== "pass" || !checks.composition) {
    return { result: "failed", detail: "The holdings document does not match this fund's record on X Layer." };
  }
  // The publisher stores ISO milliseconds; the registry stores Unix seconds.
  // Require the same second, as the write to the registry does, without rounding forward.
  if (fund.nav?.perShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(fund.nav.asOf) / 1_000) !== Math.floor(Date.parse(record.effectiveAt) / 1_000)) {
    return { result: "failed", detail: "The page's NAV or timestamp differs from the record on X Layer. Waiting for a matching update." };
  }
  if ((options.now ?? Date.now()) - Date.parse(record.effectiveAt) > DEMO_NAV_MAX_AGE_MS) {
    return { result: "unavailable", detail: "The latest NAV is over an hour old. Orders are paused until a fresh record is available." };
  }
  return { result: "matched", detail: "Your browser read this fund's record on X Layer, hashed its holdings document and recalculated the NAV shown here: they match.", record, composition: checks.composition };
}
