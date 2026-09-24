"use client";

import { useEffect, useState } from "react";
import { Arrow } from "./DesignElements";
import { formatUsdMicros } from "@/lib/nav-display";
import { pricingStatus, publicationStatus, type PricingSnapshot } from "@/lib/nav-status";
import RecordTime from "./RecordTime";

type Snapshot = {
  onchain: { navPerShareMicros: string; effectiveAt: string | null } | null;
  registry: { chainName: string };
  onchainError: string | null;
  latest: (NonNullable<PricingSnapshot> & { publication?: { status: string } | null }) | null;
};

export default function NavPreview({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setNow(Date.now());
      try {
        const response = await fetch("/api/xstocks", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("NAV unavailable");
        setSnapshot(await response.json() as Snapshot);
        setUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  const record = snapshot?.onchain?.effectiveAt ? snapshot.onchain : null;
  const status = unavailable || snapshot?.onchainError
    ? record ? "Last loaded record · refresh unavailable" : "Record unavailable"
    : record ? "Recorded on chain" : snapshot ? "Awaiting publication" : "Loading on-chain record";
  const nav = record ? formatUsdMicros(record.navPerShareMicros, 4) : "—";
  const pricing = pricingStatus(snapshot?.latest ?? null, now, unavailable);

  const publication = publicationStatus(record, snapshot?.latest ?? null, now, unavailable || Boolean(snapshot?.onchainError));

  return (
    <section className={`launch-proof-panel${compact ? " is-compact" : ""}`} aria-label="GMD USTX published value">
      <div className="preview-reading" aria-live="polite" aria-atomic="true">
        <div><span>Last published NAV <small>/ USD</small></span><strong>{nav}</strong></div>
        <span className={`preview-state${record && !unavailable && !snapshot?.onchainError ? " is-published" : ""}`}><i />{status}</span>
      </div>
      <dl className="preview-facts"><div><dt>Effective</dt><dd><RecordTime value={record?.effectiveAt} /></dd></div><div><dt>Pricing cycle</dt><dd className={`pricing-label pricing-${pricing.tone}`}>{snapshot || unavailable ? pricing.label : "Loading…"}</dd></div><div><dt>Publication</dt><dd className={`pricing-label pricing-${publication.tone}`}>{snapshot || unavailable ? publication.label : "Loading…"}</dd></div></dl>
      <div className="preview-footer"><span>One model share · {snapshot?.registry.chainName ?? "X Layer Testnet"}</span><a href="/proof">Verify record <Arrow diagonal /></a></div>
    </section>
  );
}
