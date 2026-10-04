/**
 * A browser's check of an income product's record: the product's own record read from X Layer under
 * its pinned product key, the SHA-256 of the document this page has for it, and the NAV recomputed
 * from that document's inputs (Black–Scholes for a covered call; face or payout for the note).
 */
import type { FundDetail } from "../funds/api";
import { incomeFund } from "../funds/catalog";
import { sha256Hex } from "../engine/fixed";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { PROOF_DEPLOYMENT } from "../xstocks/proof";
import { DEMO_NAV_MAX_AGE_MS } from "../demo/ledger";
import { autocallNav, type AutocallDocument } from "./autocall";
import { coveredCallNav, type CoveredCallDocument } from "./covered-call";
import { autocallTerms } from "./terms";

export type IncomeDocument = CoveredCallDocument | AutocallDocument;
export type IncomeVerification =
  | { result: "matched"; detail: string; record: OnchainNav; document: IncomeDocument }
  | { result: "failed" | "unavailable" | "checking"; detail: string; record?: never; document?: never };

/** The NAV a document implies, or null if its inputs do not hold together. */
export function recomputeIncomeNav(productId: string, document: IncomeDocument): bigint | null {
  if (document.product !== productId) return null;
  if (document.kind === "covered-call") return coveredCallNav(document).navMicros;
  const terms = autocallTerms(productId);
  if (!terms) return null;
  // Each performance is its price over the starting level, and the worse is the lower.
  const performance = terms.underlyings.map((symbol) => Number((document.prices[symbol] / document.state.initial[symbol]).toFixed(6)));
  if (performance.some((value, index) => value !== document.performance[terms.underlyings[index]]) || Math.min(...performance) !== document.worst) return null;
  return autocallNav(terms, document.state);
}

export async function verifyIncomeSnapshot(fund: FundDetail, productId: string, options: { fetcher?: typeof fetch; now?: number } = {}): Promise<IncomeVerification> {
  const definition = incomeFund(productId);
  if (!definition || fund.id !== definition.id || fund.productKey.toLowerCase() !== definition.productKey.toLowerCase()) return { result: "failed", detail: "This response belongs to a different product." };
  const record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId, productKey: definition.productKey, fetcher: options.fetcher });
  if (!record.effectiveAt) return { result: "unavailable", detail: "No record of this product is on X Layer yet." };
  const entry = fund.history.find((item) => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase());
  if (!entry) return { result: "unavailable", detail: "A newer record is on X Layer than this page has. Waiting for the page to refresh." };
  if ((await sha256Hex(entry.canonical)).toLowerCase() !== record.holdingsHash.toLowerCase()) return { result: "failed", detail: "The document's fingerprint differs from the record on X Layer." };
  let document: IncomeDocument;
  try { document = JSON.parse(entry.canonical) as IncomeDocument; } catch { return { result: "failed", detail: "The document could not be read." }; }
  const nav = recomputeIncomeNav(definition.id, document);
  const recorded = BigInt(record.navPerShareMicros);
  if (nav === null || (nav > recorded ? nav - recorded : recorded - nav) > 1n || document.navPerShareMicros !== record.navPerShareMicros) return { result: "failed", detail: "The NAV recomputed from the document differs from the record on X Layer." };
  if (fund.nav?.perShareMicros !== record.navPerShareMicros || Math.floor(Date.parse(fund.nav.asOf) / 1_000) !== Math.floor(Date.parse(record.effectiveAt) / 1_000)) return { result: "failed", detail: "The page's NAV or timestamp differs from the record on X Layer. Waiting for a matching update." };
  if (document.kind === "covered-call" && (options.now ?? Date.now()) - Date.parse(record.effectiveAt) > DEMO_NAV_MAX_AGE_MS) return { result: "unavailable", detail: "The latest NAV is over an hour old. Orders are paused until a fresh record is available." };
  return { result: "matched", detail: "Your browser read this product's record on X Layer, hashed its document and recomputed the NAV from it: they match.", record, document };
}
