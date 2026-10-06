/**
 * The records an income product's later records rest on: a covered call's sales (its first call and
 * each roll) and a note's fixing, knock-in and observations. Each is kept once confirmed, in the
 * product's archive (fund:<id>:transitions, by recordConfirmed in lib/funds/cycle.ts), and no record
 * after one is sent until it is confirmed (lib/income/cycle.ts). A browser traces the latest record
 * back through them, each checked against its own transaction on X Layer (lib/income/verify.ts), so
 * what an earlier record decided is shown by that record rather than taken from the latest one.
 *
 * `since` is when the archive is complete from: every such record at or after it is kept. The three
 * products' archives start at their first record, on 4 October 2026.
 */
import type { Publication } from "../xstocks/cycle";
import type { AutocallDocument } from "./autocall";
import type { CoveredCallDocument } from "./covered-call";

/** An archived record: its document, the fingerprint and NAV it was recorded with, and the transaction that recorded it. */
export type ArchivedRecord = Pick<Publication, "asOf" | "navPerShareMicros" | "holdingsHash" | "canonical" | "txHash">;
export type TransitionArchive = { since: string; records: ArchivedRecord[] };
/** Monthly rolls for five years, or every event of a note, and then some. */
export const TRANSITIONS_LIMIT = 64;

export type Transition = "sale" | "fixing" | "knock-in" | "observation";

/** What a document decided at its own record: a covered call's sale, or a note's fixing, knock-in or observation. */
export function transitionsAt(document: unknown): Transition[] {
  if (!document || typeof document !== "object") return [];
  const { kind, asOf } = document as { kind?: unknown; asOf?: unknown };
  if (typeof asOf !== "string") return [];
  if (kind === "covered-call") return (document as CoveredCallDocument).call?.soldAt === asOf ? ["sale"] : [];
  if (kind !== "autocall") return [];
  const state = (document as AutocallDocument).state;
  if (!state) return [];
  const found: Transition[] = [];
  if (state.fixedAt === asOf) found.push("fixing");
  if (state.knockedInAt === asOf) found.push("knock-in");
  if ((state.observations ?? []).some((observation) => observation.observedAt === asOf)) found.push("observation");
  return found;
}

export const isIncomeTransition = (document: unknown) => transitionsAt(document).length > 0;

/** The record's name in the cycle's messages: "roll record", "knock-in record", "final record"… */
export function transitionLabel(document: unknown): string {
  const found = transitionsAt(document);
  if (found.includes("sale")) return (document as CoveredCallDocument).rolls === 0 ? "first call's record" : "roll record";
  if (found.includes("observation")) return (document as AutocallDocument).state.status === "live" ? "observation record" : "final record";
  if (found.includes("knock-in")) return "knock-in record";
  if (found.includes("fixing")) return "fixing record";
  return "record";
}

/**
 * The archive after a confirmed record: created by the first one (whose time becomes `since`), and
 * given each transition once, oldest first. Returns the same archive when nothing changes.
 */
export function addTransition(archive: TransitionArchive | null, publication: Publication): TransitionArchive {
  const base = archive ?? { since: publication.asOf, records: [] };
  if (publication.status !== "confirmed") return base;
  let document: unknown = null;
  try { document = JSON.parse(publication.canonical); } catch { return base; }
  if (!isIncomeTransition(document) || base.records.some((record) => record.asOf === publication.asOf || record.holdingsHash === publication.holdingsHash)) return base;
  const { asOf, navPerShareMicros, holdingsHash, canonical, txHash } = publication;
  const records = [...base.records, { asOf, navPerShareMicros, holdingsHash, canonical, txHash }].sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
  const kept = records.slice(-TRANSITIONS_LIMIT);
  // Dropping the oldest leaves the archive complete only from the oldest it keeps.
  return { since: kept.length < records.length ? kept[0].asOf : base.since, records: kept };
}
