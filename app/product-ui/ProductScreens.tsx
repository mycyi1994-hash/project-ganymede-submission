"use client";

import { FundList, FundMarketPreview } from "./Funds";
import { IncomeMarket } from "./Income";
import { USTX_FUND, otherFund } from "@/lib/funds/catalog";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUsdMicros } from "@/lib/nav-display";
import { publicationStatus } from "@/lib/nav-status";
import { compositionForRecord, formatCountdown, nextRecordAt, publicationHistory, shortTime } from "@/lib/product-market";
import type { OnchainNav } from "@/lib/xstocks/onchain";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { useMarket } from "./MarketProvider";
import { CATEGORY_EVENT } from "./AskUstx";
import { Icon } from "./Icons";
import { designLink } from "./ProductShell";
import MarketChart from "./MarketChart";
import { InvestPanel } from "./DemoInvest";
import { FundHoldings, FundOverview, FundStats } from "./Fund";
import { LendingSection } from "./Lending";
import { ActivityProvider, MarketActivitySection, MarketPulse } from "./MarketActivity";
import Holdings from "./Holdings";
import { useRecordCheck } from "./useRecordCheck";
import { OkxSource } from "./OkxSource";
import PriceConfidence from "./PriceConfidence";

const VERIFY = "/products/ustx/transparency";

export function DataState() {
  const { error, data, loading, reload } = useMarket();
  if (!error && !data?.onchainError) return null;
  return <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error ? data ? "Refresh unavailable. Showing the last loaded record." : "Market data could not be loaded." : "Price confirmation is unavailable. Showing the last available price."}</span><button disabled={loading} onClick={reload}>{loading ? "Refreshing…" : "Try again"}</button></div>;
}

/** Seconds to the next five-minute NAV record; once it is due, the market is read until it arrives. */
function useNextRecord(effectiveAt: string | null) {
  const { reload } = useMarket();
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; });
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const due = effectiveAt ? nextRecordAt(effectiveAt) : 0;
  useEffect(() => {
    if (!due) return;
    // The job starts on the boundary and the record is on X Layer some seconds later.
    const timers = [15, 35, 60, 90, 130, 175].map(seconds => due + seconds * 1_000 - Date.now()).filter(wait => wait > 0).map(wait => window.setTimeout(() => reloadRef.current(), wait));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [due]);
  if (!clock || !due) return null;
  if (clock < due) return `Next NAV in ${formatCountdown(due - clock)}`;
  // An hour-old record is not "about to" update: past three minutes the status says it is the last one.
  return clock < due + 180_000 ? "Recording the next NAV…" : null;
}

function NavValue() {
  const { data, now, error, loading } = useMarket();
  const { checks } = useRecordCheck(data, error);
  const read = checks?.record?.effectiveAt ? checks.record : null;
  // The record this browser read last stays while each refresh is read again, so the value does not blank.
  const [last, setLast] = useState<OnchainNav | null>(null);
  if (read && read !== last) setLast(read);
  // When this browser cannot read X Layer, the record the server read from the pinned registry is shown, as unconfirmed here.
  const pinned = data?.registry.chainId === PROOF_DEPLOYMENT.chainId && data.registry.address?.toLowerCase() === PROOF_DEPLOYMENT.registry;
  const unconfirmed = !read && checks?.error && pinned && data?.onchain?.effectiveAt ? data.onchain : null;
  const record = read ?? unconfirmed ?? (checks ? null : last);
  const status = publicationStatus(record, data?.latest ?? null, now, Boolean(error || data?.onchainError));
  const next = useNextRecord(record && status.tone === "ready" ? record.effectiveAt : null);
  // A new record flashes the value: up in green, down in red. The first one read does not.
  const [seen, setSeen] = useState<{ at: string; nav: string } | null>(null);
  const [flash, setFlash] = useState<{ at: string; tone: "up" | "down" | "same" } | null>(null);
  if (record?.effectiveAt && seen?.at !== record.effectiveAt) {
    setSeen({ at: record.effectiveAt, nav: record.navPerShareMicros });
    if (seen) { const change = BigInt(record.navPerShareMicros) - BigInt(seen.nav); setFlash({ at: record.effectiveAt, tone: change > 0n ? "up" : change < 0n ? "down" : "same" }); }
  }
  // Customers see when the price was recorded; an older record reads "last recorded", not an error.
  const state = !data && loading ? "Loading…" : !record ? "Confirming the price…" : record === unconfirmed ? "Price confirmation unavailable" : status.tone === "ready" ? "Recorded on X Layer" : "Last recorded on X Layer";
  return <div className="gmd-nav-summary"><div><span className="gmd-label">NAV per share <span>/ USD</span></span>{!data && loading ? <strong className="gmd-value"><i className="gmd-skeleton is-hero" aria-hidden="true" /><span className="gmd-sr-only">Loading</span></strong> : <strong key={flash?.at ?? "value"} className={`gmd-value${flash ? ` is-${flash.tone}` : ""}`}>{record ? formatUsdMicros(record.navPerShareMicros, 4) : "—"}</strong>}</div><div className="gmd-nav-meta"><OkxSource>Priced by OKX OnchainOS</OkxSource><span className={`gmd-status ${status.tone === "ready" && record !== unconfirmed ? "is-neutral" : "is-waiting"}`}><i />{state}</span><time dateTime={record?.effectiveAt ?? undefined}>{record ? shortTime(record.effectiveAt) : ""}</time>{next && <span className="gmd-live"><i aria-hidden="true" />{next}</span>}</div></div>;
}

function ProductIdentity({ compact = false }: { compact?: boolean }) {
  return <div className={`gmd-product-identity${compact ? " is-compact" : ""}`}><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">USTX <span>Equity basket</span></span>{compact ? <h2>US Tech Basket</h2> : <h1>US Tech Basket</h1>}<p>Apple, Microsoft, NVIDIA, Alphabet, Amazon, Meta, Tesla, Oracle and Palantir.</p></div></div>;
}

type Category = "all" | "basket" | "income" | "structured";
const CATEGORIES: { id: Category; label: string; note: string }[] = [
  { id: "all", label: "All", note: "9 products" },
  { id: "basket", label: "RWA baskets", note: "6 equity ETFs" },
  { id: "income", label: "Income", note: "Covered calls" },
  { id: "structured", label: "Structured", note: "ELS notes" },
];

export function MarketScreen({ preview = false }: { preview?: boolean }) {
  const { data, loading } = useMarket();
  const [selectedId, setSelectedId] = useState(USTX_FUND.id);
  const [category, setCategory] = useState<Category>("all");
  // A link such as /?category=income opens on that category.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("category");
    if (!wanted || !CATEGORIES.some(item => item.id === wanted)) return;
    const timer = window.setTimeout(() => setCategory(wanted as Category), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const selectedFund = otherFund(selectedId);
  const feature = useRef<HTMLElement>(null);
  const selectFund = (id: string) => {
    if (id !== USTX_FUND.id && !otherFund(id)) return;
    setSelectedId(id);
    // Move focus with the preview so keyboard and screen-reader users land on the updated card.
    requestAnimationFrame(() => {
      feature.current?.focus({ preventScroll: true });
      feature.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  };
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  const detail = preview ? designLink("product") : "/products/ustx";
  const baskets = category === "all" || category === "basket";
  const screen = <><div className="gmd-page-heading"><div><h1>Markets</h1><p>RWA baskets, covered-call income and structured notes on tokenized US stocks, priced by OKX and recorded on X Layer.</p></div>{preview && <span className="gmd-badge">Example account view</span>}</div>
    {!preview && <nav className="gmd-categories" aria-label="Product categories">{CATEGORIES.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); window.history.replaceState(null, "", item.id === "all" ? "/" : `/?category=${item.id}`); window.dispatchEvent(new Event(CATEGORY_EVENT)); }}><b>{item.label}</b><small>{item.note}</small></button>)}</nav>}
    {!preview && !baskets && <><div className="gmd-category-intro"><h2>{category === "income" ? "Covered-call income" : "Structured notes (ELS)"}</h2><p>{category === "income" ? "Hold the S&P 500 or the Nasdaq-100 and sell a call each month: income now, in exchange for the gains above the strike. Like XYLD and QYLD." : "A step-down autocallable note on the S&P 500 and the Nasdaq-100: 7% a year if both hold up, paid back early at six-monthly observations; capital at risk only after a 50% fall."}</p></div>
      <IncomeMarket key={category} kind={category === "income" ? "covered-call" : "autocall"} /></>}
    {baskets && <>{!selectedFund && <DataState />}
    <section ref={feature} id="market-fund-preview" tabIndex={-1} className="gmd-market-feature" aria-label={selectedFund?.name ?? USTX_FUND.name}>{selectedFund ? <FundMarketPreview key={selectedFund.id} definition={selectedFund} /> : <><div className="gmd-market-primary"><div className="gmd-feature-title"><ProductIdentity compact /><Link prefetch={false} className="gmd-button" href={preview ? detail : `${detail}#investment`}>Invest <Icon name="arrow" size={18} /></Link></div><NavValue />{!preview && <FundStats />}<MarketChart points={points} loading={loading} /><div className="gmd-feature-bottom"><span>Equal weight <i /> Rebalanced quarterly <i /> Min. $10</span><span className="gmd-badge">Demo fund</span></div></div><div className="gmd-market-composition"><Holdings composition={composition} compact loading={loading} /></div></>}</section>
    {!preview && !selectedFund && <PriceConfidence compact />}
    {!preview && <FundList selectedId={selectedId} onSelect={selectFund} controls="market-fund-preview" kinds={category === "basket" ? ["basket"] : undefined} />}
    {!preview && !selectedFund && <MarketPulse />}</>}
  </>;
  return preview ? screen : <ActivityProvider>{screen}</ActivityProvider>;
}

export function ProductScreen({ preview = false, orderPanel, holding = false }: { preview?: boolean; orderPanel?: ReactNode; holding?: boolean }) {
  const { data, loading } = useMarket();
  const composition = data ? compositionForRecord(data) : null;
  const points = data ? publicationHistory(data) : [];
  const screen = <><Link prefetch={false} className="gmd-breadcrumb" href={holding ? designLink("portfolio") : preview ? designLink("markets") : "/"}><Icon name="back" size={16} />{holding ? "Your portfolio" : "All markets"}</Link><div className="gmd-product-heading"><ProductIdentity />{preview && <span className="gmd-badge">Example account view</span>}</div><div className={`gmd-mobile-entry${holding ? " is-holding" : ""}`}>{preview ? <a className="gmd-button" href="#investment">View investment panel<Icon name="arrow" size={16} /></a> : <a className="gmd-button" href="#investment">Invest<Icon name="arrow" size={16} /></a>}</div><DataState />
    <div className={`gmd-detail-layout${holding ? " is-holding" : ""}`}><div className="gmd-detail-content"><section className="gmd-price-surface" aria-label="Basket value"><NavValue /><MarketChart points={points} loading={loading} /></section><nav className="gmd-product-sections" aria-label="Product sections">{!preview && <a href="#overview">Overview</a>}{!preview && <a href="#activity">Activity</a>}{!preview && <a href="#borrow">Borrow</a>}<a href="#holdings">Holdings</a>{!preview && <Link prefetch={false} href="/pools">Pools <Icon name="arrow" size={14} /></Link>}<Link prefetch={false} href={VERIFY}>Transparency <Icon name="external" size={14} /></Link></nav>{!preview && <FundOverview />}{!preview && <MarketActivitySection />}{!preview && <LendingSection />}<div id="holdings" className="gmd-composition-surface">{preview ? <Holdings composition={composition} loading={loading} /> : <FundHoldings />}</div>
    </div><div className="gmd-detail-aside" id="investment">{orderPanel ?? <InvestPanel />}</div></div>
  </>;
  return preview ? screen : <ActivityProvider>{screen}</ActivityProvider>;
}
