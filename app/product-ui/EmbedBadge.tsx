"use client";

import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { BrandMark } from "../DesignElements";
import { Icon } from "./Icons";
import { MarketProvider, useMarket } from "./MarketProvider";
import { useRecordCheck } from "./useRecordCheck";
import "./product.css";

// A badge other sites can embed in an iframe. It runs the same browser check as the
// verification page: the visitor's browser reads X Layer itself, not this server's word.

function Badge({ site }: { site: string }) {
  const { data, error } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const record = checks?.record?.effectiveAt ? checks.record : data?.onchain?.effectiveAt ? data.onchain : null;
  const label = { matched: "Verified in your browser", failed: "Record needs attention", unavailable: "Not verified", waiting: "Checking the record…", loading: "Checking the record…" }[state];
  return <div className="gmd-embed-card">
    <header><span className="gmd-embed-brand"><BrandMark />Ganymede</span><span className="gmd-embed-network">X Layer</span></header>
    <div className="gmd-embed-product"><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><h1>USTX · US Tech Basket</h1><small>Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla</small></div></div>
    <div className="gmd-embed-nav"><span>NAV per share</span><strong>{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong><small>{record ? `Recorded on X Layer · ${shortTime(record.effectiveAt)}` : "Reading the record on X Layer…"}</small></div>
    <footer>
      <a className={`gmd-check-chip is-${state}`} href={`${site}/products/ustx/transparency`} target="_blank" rel="noreferrer" aria-live="polite">{state === "matched" ? <Icon name="check" size={15} /> : <i aria-hidden="true" />}<span>{label}</span></a>
      <a className="gmd-embed-invest" href={`${site}/products/ustx`} target="_blank" rel="noreferrer">Invest <Icon name="arrow" size={15} /><span className="gmd-sr-only"> (opens Ganymede in a new tab)</span></a>
    </footer>
  </div>;
}

export default function EmbedBadge({ site }: { site: string }) {
  return <MarketProvider><main className="gmd-app gmd-embed"><Badge site={site} /></main></MarketProvider>;
}
