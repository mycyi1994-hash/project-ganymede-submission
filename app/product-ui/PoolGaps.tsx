"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { DEMO_ORDER_EVENT } from "@/lib/demo/format";
import { gapsOf, newestReads, poolRead, poolReads, signedGap, withPoolRead, type PoolGap, type PoolGapId, type PoolRead } from "@/lib/xstocks/pool-gaps";
import { Icon } from "./Icons";

/**
 * One read of GET /api/v1/ustx/pools for the whole page, so the USTX card on Markets, the gauge on
 * the product and pool pages and Ask USTX show the same gaps. It is read every minute while the page
 * is visible and something shows it, and after an order; a pool this page has itself read from X Layer
 * at a later block, as it does after an order, stands in for the API's read of it until the API catches up.
 */
type Pools = { body: unknown; reads: PoolRead[] };
let pools: Pools | null = null;
let loadedAt = 0;
let loading: Promise<void> | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();

function publish(next: Pools) {
  pools = next;
  for (const listener of listeners) listener();
}

function load(force = false) {
  if (loading || (!force && Date.now() - loadedAt < 30_000)) return;
  loading = fetch("/api/v1/ustx/pools", { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<unknown> : null)
    .catch(() => null)
    .then(body => {
      if (body) {
        loadedAt = Date.now();
        publish({ body, reads: newestReads(pools?.reads ?? [], poolReads(body)) });
      } else if (pools?.body && Date.now() - loadedAt > 180_000) {
        // Three minutes without a read: the gaps are taken down rather than left looking current.
        publish({ body: null, reads: [] });
      }
    })
    .finally(() => { loading = null; });
}

const reload = () => load(true);

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    load();
    timer = window.setInterval(() => { if (!document.hidden) load(true); }, 60_000);
    window.addEventListener(DEMO_ORDER_EVENT, reload);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { window.clearInterval(timer); window.removeEventListener(DEMO_ORDER_EVENT, reload); }
  };
}

/** A pool this page read from X Layer itself, kept while it is newer than the API's read of it (see withPoolRead). */
function notePoolRead(read: PoolRead) {
  const held = pools?.reads ?? [];
  const reads = withPoolRead(held, read);
  if (reads !== held) publish({ body: pools?.body ?? null, reads });
}

/** The last pools API body and each pool's newest read, null before the first. */
export function usePools(): Pools | null {
  return useSyncExternalStore(subscribe, () => pools, () => null);
}

/** Each USTX pool's price against the NAV, from its newest read; null before the first. */
export function usePoolGaps(): PoolGap[] | null {
  const state = usePools();
  return state ? gapsOf(state.reads) : null;
}

/** Shares a pool this page read from X Layer at `block` with the parts that only read the API. */
export function useNotePoolRead(id: PoolGapId, block: number | null, priceMicros: bigint | null, navMicros: bigint | null) {
  useEffect(() => { if (block !== null) notePoolRead(poolRead(id, block, priceMicros, navMicros)); }, [id, block, priceMicros, navMicros]);
}

/** One line on the Markets card: where each pool trades against the NAV. Nothing while the NAV is not usable. */
export function PoolGapsLine() {
  const gaps = usePoolGaps();
  if (!gaps?.length) return null;
  return <p className="gmd-pool-gaps">
    <span>Pools against the NAV</span>
    {gaps.map(gap => <span key={gap.id} className="gmd-pool-gap"><b>{gap.short}</b> <span title={gap.name}>{signedGap(gap.premiumPpm)}</span></span>)}
    <Link prefetch={false} href="/pools">Pools <Icon name="arrow" size={14} /></Link>
  </p>;
}
