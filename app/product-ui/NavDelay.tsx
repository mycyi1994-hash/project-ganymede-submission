"use client";

import { useEffect, useState } from "react";
import { shortTime } from "@/lib/product-market";

// Whether the latest USTX NAV record is past the hour the fund and the lending market accept it,
// from the public NAV API (served from a recent read), shared by every component on the page and
// read again every two minutes. Until the first read, and whenever it fails, nothing is claimed.

type NavRecord = { effectiveAt: string; validUntil: string } | null;
let shared: { at: number; value: Promise<NavRecord> } | null = null;

function readRecord(): Promise<NavRecord> {
  if (shared && Date.now() - shared.at < 60_000) return shared.value;
  const value = fetch("/api/v1/ustx", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(body => typeof body?.nav?.effectiveAt === "string" && typeof body.nav.validUntil === "string" ? { effectiveAt: body.nav.effectiveAt, validUntil: body.nav.validUntil } : null)
    .catch(() => null);
  shared = { at: Date.now(), value };
  return value;
}

export type NavDelay = { effectiveAt: string; validUntil: string; lateMs: number };

/** The latest record while it is past its hour, so orders and new loans wait for the next one; otherwise null. */
export function useNavDelay(): NavDelay | null {
  const [state, setState] = useState<{ record: NavRecord; now: number }>({ record: null, now: 0 });
  useEffect(() => {
    let alive = true;
    const load = () => void readRecord().then(record => { if (alive) setState({ record, now: Date.now() }); });
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 120_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const { record, now } = state;
  if (!record || !now || now < Date.parse(record.validUntil)) return null;
  return { ...record, lateMs: now - Date.parse(record.effectiveAt) };
}

/** "4 h 40 min" or "35 min", with no-break spaces so a number keeps its unit on the same line. */
export function delayText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}\u00a0h ${minutes % 60}\u00a0min` : `${minutes}\u00a0min`;
}

/** A notice on every screen while the NAV record is past its hour. */
export function NavDelayNotice() {
  const delay = useNavDelay();
  if (!delay) return null;
  return <p className="gmd-delay-notice" role="status"><b>NAV record delayed</b> The latest is from {shortTime(delay.effectiveAt)}, {delayText(delay.lateMs)} ago. Orders at the fund, new loans and the two NAV-guarded pools wait for the next record; the constant-product pool still trades, at a price that drifts from the NAV.</p>;
}
