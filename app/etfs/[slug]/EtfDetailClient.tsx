"use client";

import { KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SiteFooter, StrategyGlyph } from "../../DesignElements";
import SiteHeader from "../../SiteHeader";
import DataNotice from "../../DataNotice";
import { currentWalletAddress } from "../../WalletConnect";
import { DEFAULT_SETTLEMENT_CHAIN } from "@/lib/chains";
import { isPendingRequest } from "@/lib/portfolio-display";
import { estimatePaperAllocation } from "@/lib/simulation";
import type { BasketAsset, Etf } from "../../data/etfs";

type ProductTab = "overview" | "performance" | "holdings" | "methodology" | "documents";

type LiveProduct = {
  id: string;
  strategyStyle: "passive" | "active";
  status: string;
  nav: null | {
    navPerShareMicros: string;
    netAssetValueKrw: string;
    asOf: string;
    quality: string;
  };
  targets: Array<{ symbol: string; target_weight_bps: number; rationale: string; effective_at: string }>;
  lastRebalance: null | { status?: string; completed_at?: string };
};

type MarketPayload = {
  products: LiveProduct[];
  lastCycle: null | { mode: "paper" | "live"; marketDataQuality: string; completedAt: string };
};

function asNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatKrw(value: string | number) {
  return `₩${asNumber(value).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
}

function formatNav(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return `₩${(asNumber(value) / 1_000_000).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWeight(value: number) {
  return Number(value.toFixed(2)).toString();
}

const tabs: Array<{ id: ProductTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Model results" },
  { id: "holdings", label: "Holdings" },
  { id: "methodology", label: "How it works" },
  { id: "documents", label: "Risks & documents" },
];

const shades = ["#283e52", "#55738b", "#7e99ad", "#a3bbc8", "#657e72", "#c2d3d8"];

const assetMetadata: Record<string, { name: string; assetClass: string }> = {
  BTC: { name: "Bitcoin", assetClass: "Store of Value" },
  ETH: { name: "Ethereum", assetClass: "Smart Contract" },
  XRP: { name: "XRP", assetClass: "Payments" },
  SOL: { name: "Solana", assetClass: "Smart Contract" },
  DOGE: { name: "Dogecoin", assetClass: "Payments" },
  ADA: { name: "Cardano", assetClass: "Smart Contract" },
  TRX: { name: "TRON", assetClass: "Payments" },
  AVAX: { name: "Avalanche", assetClass: "Smart Contract" },
  LINK: { name: "Chainlink", assetClass: "Infrastructure" },
  DOT: { name: "Polkadot", assetClass: "Interoperability" },
  SUI: { name: "Sui", assetClass: "Smart Contract" },
  NEAR: { name: "NEAR Protocol", assetClass: "Smart Contract" },
  APT: { name: "Aptos", assetClass: "Smart Contract" },
  ETC: { name: "Ethereum Classic", assetClass: "Smart Contract" },
  CASH: { name: "Fund Cash Buffer", assetClass: "Cash" },
};

function AssetMark({ asset }: { asset: BasketAsset }) {
  return <span className={`detail-asset-mark mark-${asset.iconKey}`} aria-hidden="true">{asset.ticker.slice(0, 1)}</span>;
}

function ProductTabs({ active, onChange }: { active: ProductTab; onChange: (tab: ProductTab) => void }) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: ProductTab) => {
    if (!(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((tab) => tab.id === current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex].id;
    onChange(next);
    requestAnimationFrame(() => document.getElementById(`product-tab-${next}`)?.focus());
  };

  return (
    <div className="product-tabs" role="tablist" aria-label="ETF product information">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`product-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`product-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          className={active === tab.id ? "is-active" : ""}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, tab.id)}
        >{tab.label}</button>
      ))}
    </div>
  );
}

function useLocalDialogFocus(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  // A new closure arrives with every render (e.g. while saving); focus is set up only once.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    dialog.tabIndex = -1;
    dialog.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);
  return dialogRef;
}

function SimulationReviewDialog({ etf, amountKrw, nav, submitting, error, onCancel, onConfirm }: {
  etf: Etf;
  amountKrw: string;
  nav: string;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const copyId = useId();
  const dialogRef = useLocalDialogFocus(onCancel);
  const estimate = estimatePaperAllocation(amountKrw, nav, etf.fee);
  return (
    <div className="confirm-backdrop simulation-review-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.currentTarget === event.target) onCancel(); }}>
      <section ref={dialogRef} className="simulation-review-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={copyId} aria-busy={submitting}>
        <span>STEP 02 OF 03 / REVIEW</span>
        <h2 id={titleId}>Review your paper allocation.</h2>
        <p id={copyId}>You are simulating {formatKrw(amountKrw)} in {etf.ticker}. No order will be placed and no funds will be transferred.</p>
        <div className="review-allocation"><span>{formatKrw(amountKrw)} SAMPLE</span><strong>{estimate.shares?.toLocaleString("en-US", { maximumFractionDigits: 3 }) ?? "—"}<small>estimated paper shares</small></strong></div>
        <dl><div><dt>STRATEGY</dt><dd>{etf.name}</dd></div><div><dt>INDICATIVE VALUE / SHARE</dt><dd>{formatNav(nav, "—")}</dd></div><div><dt>ANNUAL FEE RATE</dt><dd>{etf.fee}</dd></div><div><dt>ILLUSTRATIVE YEARLY FEE</dt><dd>{estimate.annualFeeKrw === null ? "—" : formatKrw(estimate.annualFeeKrw)}</dd></div></dl>
        <p className="fee-assumption">Fee illustration assumes the sample value stays unchanged for one year. It is not deducted upfront; taxes, spreads and other costs are excluded.</p>
        <div className="simulation-review-warning"><i /> TEST ENVIRONMENT · NO ECONOMIC ASSET IS ISSUED ON {DEFAULT_SETTLEMENT_CHAIN.label}</div>
        {error && <div className="simulation-review-error" role="alert"><p>{error}</p><Link href="/?app=portfolio">CHECK PAPER PORTFOLIO ↗</Link></div>}
        <footer role="none"><button type="button" disabled={submitting} onClick={onCancel}>Edit amount</button><button type="button" className="is-primary" disabled={submitting || estimate.shares === null} aria-busy={submitting} onClick={onConfirm}>{submitting ? "Saving simulation…" : "Save to paper portfolio"}</button></footer>
      </section>
    </div>
  );
}

function OverviewPanel({ etf, liveProduct, engineMode, amountKrw, subscriptionStatus, submitting, orderError, onAmountChange, onSubscribe, onHoldings }: {
  etf: Etf;
  liveProduct: LiveProduct | null;
  engineMode: "paper" | "live";
  amountKrw: string;
  subscriptionStatus: string;
  submitting: boolean;
  orderError: string;
  onAmountChange: (value: string) => void;
  onSubscribe: () => void;
  onHoldings: () => void;
}) {
  const estimate = estimatePaperAllocation(amountKrw, liveProduct?.nav?.navPerShareMicros, etf.fee);
  const hasRequest = Boolean(subscriptionStatus);
  const amountHelpId = useId();
  const amountErrorId = useId();
  const holdings = liveProduct?.targets.length
    ? liveProduct.targets.map((asset) => ({ ticker: asset.symbol, weight: asset.target_weight_bps / 100 }))
    : etf.basket;
  const leadingHoldings = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 3);
  return (
    <div className="product-overview-panel">
      <div className="product-overview-main">
        <article className="product-information-card strategy-at-glance">
          <span>INVESTMENT OBJECTIVE</span>
          <h3>A closer look at the strategy.</h3>
          <p>{etf.description}</p>
          <div className="strategy-fit"><div><span>PORTFOLIO ROLE</span><p>{etf.bestFor}</p></div><div><span>MAY NOT SUIT</span><p>{etf.notFor}</p></div></div>
          <div className="holdings-preview-heading"><span>{liveProduct?.targets.length ? "LEADING TARGET HOLDINGS" : "MODEL HOLDINGS"}</span><button type="button" onClick={onHoldings}>View all ↗</button></div>
          <ul className="holdings-preview">{leadingHoldings.map((asset) => <li key={asset.ticker}><span>{asset.ticker}</span><div><i style={{ width: `${asset.weight}%` }} /></div><b>{formatWeight(asset.weight)}%</b></li>)}</ul>
        </article>

        <article className="product-information-card risk-summary-card">
          <span>RISK & COST</span>
          <div className="risk-cost-heading"><h3>{etf.risk.toLowerCase()} risk</h3><span>{etf.fee}<small>annual management fee</small></span></div>
          <p>{etf.methodology.risk}</p>
          <details className="detail-disclosure"><summary>Read the key risks <span aria-hidden="true">+</span></summary><ul><li>Digital assets may experience extreme price volatility and liquidity gaps.</li><li>Index methodology and constituent eligibility may change at rebalance.</li><li>Displayed performance may not include taxes, spreads or all execution costs.</li></ul></details>
        </article>

        <details className="product-information-card product-facts-card detail-disclosure">
          <summary>More product facts <span aria-hidden="true">+</span></summary>
          <dl><div><dt>Benchmark</dt><dd>{etf.benchmark}</dd></div><div><dt>Model inception</dt><dd>{etf.inceptionDate}</dd></div><div><dt>Domicile</dt><dd>{etf.domicile}</dd></div><div><dt>Distribution</dt><dd>{etf.distribution}</dd></div><div><dt>Minimum sample</dt><dd>{etf.minimum}</dd></div><div><dt>Rebalance</dt><dd>{etf.rebalanceFrequency}</dd></div></dl>
        </details>
      </div>

      <aside className="product-order-card" aria-label="ETF allocation simulation" aria-busy={submitting}>
        <div className="order-card-heading" tabIndex={-1}><span>ALLOCATION SIMULATOR</span><b>{engineMode === "live" ? "LIVE CONTROLLED" : "PAPER / TESTNET"}</b></div>
        <h3>Try the numbers.</h3>
        <p>See what a sample allocation could look like. No real order is placed and no money moves.</p>
        <ol className="subscription-steps" aria-label="Simulation steps"><li className={!hasRequest ? "is-active" : ""} aria-current={!hasRequest ? "step" : undefined}><b>01</b><span>AMOUNT</span></li><li><b>02</b><span>REVIEW</span></li><li className={hasRequest ? "is-active" : ""} aria-current={hasRequest ? "step" : undefined}><b>03</b><span>SAVE</span></li></ol>
        {hasRequest ? <div className="subscription-success" role="status"><b>Simulation saved.</b><p>{subscriptionStatus === "settled" ? "Your paper allocation is ready in your portfolio." : "Your request is saved. Follow its progress in your portfolio."}</p></div> : <>
          <label className="subscription-amount"><span>SAMPLE AMOUNT / KRW</span><input type="number" min="100000" max="1000000000" step="1" inputMode="numeric" value={amountKrw} onChange={(event) => onAmountChange(event.target.value)} aria-invalid={Boolean(estimate.amountError)} aria-describedby={`${amountHelpId}${estimate.amountError ? ` ${amountErrorId}` : ""}`} /></label>
          <p className="amount-help" id={amountHelpId}>₩100,000 to ₩1,000,000,000 · whole KRW amounts.</p>
          {estimate.amountError && <p className="amount-error" id={amountErrorId}>{estimate.amountError}</p>}
          <div className="amount-presets" aria-label="Quick amount selection">{["500000", "1000000", "5000000"].map((value) => <button key={value} type="button" aria-pressed={amountKrw === value} onClick={() => onAmountChange(value)}>{formatKrw(value)}</button>)}</div>
          <div className="simulation-estimate" aria-live="polite" aria-atomic="true"><span>ESTIMATED PAPER SHARES</span><strong>{estimate.shares?.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) ?? "—"}</strong><small>At {formatNav(liveProduct?.nav?.navPerShareMicros, "—")} per share</small></div>
          <dl><div><dt>ANNUAL FEE RATE</dt><dd>{etf.fee}</dd></div><div><dt>ILLUSTRATIVE YEARLY FEE</dt><dd>{estimate.annualFeeKrw === null ? "—" : formatKrw(estimate.annualFeeKrw)}</dd></div></dl>
          <p className="fee-assumption">Assumes an unchanged sample value for one year. Not an upfront charge. Excludes taxes, spreads and other costs.</p>
        </>}
        <button type="button" disabled={submitting || (!hasRequest && estimate.shares === null)} aria-busy={submitting} className={`product-add-button${hasRequest ? " is-added" : ""}`} onClick={onSubscribe}>{submitting ? "Saving simulation…" : hasRequest ? "View paper portfolio" : "Review simulation →"}</button>
        {!hasRequest && !liveProduct?.nav && <p className="amount-help">Waiting for an indicative NAV before an estimate is available.</p>}
        {orderError && <p className="subscription-error" role="alert">{orderError}</p>}
        <small className="simulation-note">Simulation only · no economic asset is issued. Estimates may change at the next valuation. A test wallet is optional.</small>
      </aside>
    </div>
  );
}

function PerformancePanel({ etf }: { etf: Etf }) {
  const months = ["AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL"];
  return (
    <div className="performance-panel">
      <div className="model-data-banner"><span>MODEL DATA</span><p>Illustrative strategy history · not an administrator-verified track record</p></div>
      <dl className="performance-summary">
        <div><dt>YTD</dt><dd>+{etf.ytdReturn}</dd></div>
        <div><dt>1 YEAR</dt><dd>+{etf.oneYearReturn}</dd></div>
        <div><dt>SINCE INCEPTION</dt><dd>+{etf.sinceInceptionReturn}</dd></div>
        <div><dt>VOLATILITY</dt><dd>{etf.volatility}</dd></div>
        <div><dt>MAX DRAWDOWN</dt><dd>{etf.maxDrawdown}</dd></div>
      </dl>
      <article className="return-chart-card">
        <header><div><span>MONTHLY MODEL RETURNS</span><h3>Trailing 12 months</h3></div><p>Return %</p></header>
        <div className="return-chart" role="img" aria-label={`Monthly returns for ${etf.name}: ${etf.monthlyReturns.join(", ")} percent`}>
          {etf.monthlyReturns.map((value, index) => (
            <div className="return-column" key={months[index]}>
              <div className="return-bar-space"><i className={value >= 0 ? "is-positive" : "is-negative"} style={{ height: `${Math.abs(value) / Math.max(1, ...etf.monthlyReturns.map(Math.abs)) * 92}px` }} /></div>
              <b>{value > 0 ? "+" : ""}{value.toFixed(1)}</b>
              <span>{months[index]}</span>
            </div>
          ))}
        </div>
      </article>
      <div className="performance-disclosure"><span>i</span><p>Past or illustrative performance does not guarantee future results. Returns are shown before taxes and may not reflect actual tradability.</p></div>
    </div>
  );
}

function HoldingsPanel({ etf, liveProduct }: { etf: Etf; liveProduct: LiveProduct | null }) {
  const liveBasket: BasketAsset[] = (liveProduct?.targets ?? []).map((target, index) => {
    const metadata = assetMetadata[target.symbol] ?? { name: target.symbol, assetClass: "Digital Asset" };
    return {
      rank: index + 1,
      ticker: target.symbol,
      name: metadata.name,
      weight: target.target_weight_bps / 100,
      assetClass: metadata.assetClass,
      description: target.rationale,
      iconKey: target.symbol.toLowerCase(),
    };
  });
  const targetWeightBps = (liveProduct?.targets ?? []).reduce((sum, target) => sum + target.target_weight_bps, 0);
  if (liveBasket.length && targetWeightBps < 10_000) {
    liveBasket.push({ rank: liveBasket.length + 1, ticker: "CASH", name: "Fund Cash Buffer", weight: (10_000 - targetWeightBps) / 100, assetClass: "Cash", description: "Mandate-level liquidity and operating cash buffer.", iconKey: "cash" });
  }
  const basket = liveBasket.length ? liveBasket : etf.basket;
  const stops = basket.map((asset, index) => {
    const start = basket.slice(0, index).reduce((sum, preceding) => sum + preceding.weight, 0);
    return `${shades[index % shades.length]} ${start}% ${start + asset.weight}%`;
  }).join(",");

  return (
    <div className="holdings-panel-v2">
      <div className="basket-visual-v2">
        <div className="allocation-donut" style={{ background: `conic-gradient(${stops})` }} role="img" aria-label={`${etf.name} basket allocation`}><span><b>100</b><small>% ALLOCATED</small></span></div>
        <div><span>BASKET COMPOSITION</span><h3>{basket.length} positions, 100% allocated</h3><p>{liveBasket.length ? "Latest engine-approved target allocation, including the mandate cash buffer." : `Holdings are reviewed at each ${etf.rebalanceFrequency.toLowerCase()} rebalance and may change without notice.`}</p></div>
      </div>
      <div className="holdings-table-v2" role="table" aria-label="ETF basket holdings">
        <div className="holding-row-v2 holding-head-v2" role="row"><span role="columnheader">#</span><span role="columnheader">ASSET</span><span role="columnheader">CLASS</span><span role="columnheader">ROLE</span><span role="columnheader">ALLOCATION</span><span role="columnheader">WEIGHT</span></div>
        {basket.map((asset) => (
          <div className="holding-row-v2" role="row" key={asset.ticker}>
            <span role="cell">{String(asset.rank).padStart(2, "0")}</span>
            <span role="cell" className="holding-asset-v2"><AssetMark asset={asset} /><b>{asset.ticker}</b><small>{asset.name}</small></span>
            <span role="cell">{asset.assetClass}</span>
            <span role="cell">{asset.description}</span>
            <span role="cell" className="holding-progress"><i><b style={{ width: `${asset.weight}%` }} /></i></span>
            <span role="cell"><b>{formatWeight(asset.weight)}%</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MethodologyPanel({ etf }: { etf: Etf }) {
  const items = [
    ["01", "SELECTION", etf.methodology.selection],
    ["02", "WEIGHTING", etf.methodology.weighting],
    ["03", "REBALANCING", etf.methodology.rebalance],
    ["04", "ELIGIBILITY", etf.methodology.eligibility],
    ["05", "POSITION LIMITS", etf.methodology.limits],
    ["06", "RISK CONTROLS", etf.methodology.risk],
  ];
  return <div className="methodology-panel-v2">{items.map(([number, label, copy]) => <article key={number}><span>{number}</span><div><b>{label}</b><p>{copy}</p></div></article>)}</div>;
}

function DocumentsPanel({ etf }: { etf: Etf }) {
  const documents = [
    ["CALCULATION METHOD", "USTX NAV arithmetic and the separate paper strategy lab", "/methodology"],
    ["LIMITS & DATA POLICY", "Pricing, testnet, verification and browser-session limitations", "/limitations"],
  ];
  return (
    <div className="documents-panel">
      <section>
        <span>PRODUCT DOCUMENTS</span>
        <h3>Understand this simulation</h3><p>{etf.name} is a paper crypto strategy. Its methodology and holdings tabs describe the model; these documents explain the wider system and its limits.</p>
        {documents.map(([name, description, href], index) => (
          <article key={name}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{name}</b><p>{description}</p></div><Link href={href} className="document-status">Read document ↗</Link></article>
        ))}
      </section>
      <aside id="risk-disclosure">
        <span>IMPORTANT INFORMATION</span>
        <h3>Model strategy only</h3>
        <p>This is a model strategy in a test environment. Allocations are simulations and no fund shares are offered to the public.</p>
        <p>{DEFAULT_SETTLEMENT_CHAIN.name} is the current share-settlement rail. Testnet assets have no economic value and the relayer remains isolated from fund custody.</p>
        <p>Displayed performance is illustrative, not an administrator-verified investor track record. No approved prospectus or investable fund is provided.</p>
      </aside>
    </div>
  );
}

export default function EtfDetailClient({ etf }: { etf: Etf }) {
  const [activeTab, setActiveTab] = useState<ProductTab>("overview");
  const [liveProduct, setLiveProduct] = useState<LiveProduct | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [engineMode, setEngineMode] = useState<"paper" | "live">("paper");
  const [amountKrw, setAmountKrw] = useState("1000000");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [simulatorVisible, setSimulatorVisible] = useState(false);
  const liveTargetWeightBps = (liveProduct?.targets ?? []).reduce((sum, target) => sum + target.target_weight_bps, 0);
  const livePositionCount = (liveProduct?.targets?.length ?? 0) + (liveTargetWeightBps > 0 && liveTargetWeightBps < 10_000 ? 1 : 0);

  const openSubscription = () => {
    setActiveTab("overview");
    window.setTimeout(() => {
      const simulator = document.querySelector<HTMLElement>(".product-order-card");
      if (!simulator) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      simulator.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      simulator.querySelector<HTMLElement>(".order-card-heading")?.focus({ preventScroll: true });
    }, 50);
  };

  const openInformation = (tab: ProductTab) => {
    setActiveTab(tab);
    window.setTimeout(() => document.getElementById(`product-tab-${tab}`)?.focus(), 0);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setMarketLoading(true);
      const wallet = currentWalletAddress();
      try {
        const marketResponse = await fetch("/api/market", { cache: "no-store" });
        const market = await marketResponse.json() as MarketPayload & { error?: string };
        if (!marketResponse.ok) throw new Error(market.error || "Fund engine is unavailable");
        if (!cancelled) {
          setLiveProduct(market.products.find((product) => product.id === etf.id) ?? null);
          setEngineMode(market.lastCycle?.mode ?? "paper");
          setMarketError(false);
        }
      } catch {
        if (!cancelled) setMarketError(true);
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
      // The saved-allocation status is optional context; failing to read it says nothing about pricing.
      try {
        const walletAddress = await wallet;
        const portfolioResponse = await fetch("/api/portfolio", { cache: "no-store", headers: walletAddress ? { "x-ganymede-wallet": walletAddress } : undefined });
        if (!portfolioResponse.ok) return;
        const portfolio = await portfolioResponse.json() as { positions?: Array<{ productId: string }>; subscriptions?: Array<{ product_id?: string; productId?: string; status?: string }> };
        const latest = portfolio.subscriptions?.find((subscription) => (subscription.product_id ?? subscription.productId) === etf.id && isPendingRequest(subscription));
        const held = portfolio.positions?.some((position) => position.productId === etf.id);
        if (!cancelled) setSubscriptionStatus(held ? "settled" : latest?.status ?? "");
      } catch {
        // Leave the simulator as it is; the portfolio page shows the saved state.
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [etf.id, reloadKey]);

  useEffect(() => {
    const simulator = document.querySelector<HTMLElement>(".product-order-card");
    if (!simulator || activeTab !== "overview") {
      const reset = window.setTimeout(() => setSimulatorVisible(false), 0);
      return () => window.clearTimeout(reset);
    }
    const observer = new IntersectionObserver(([entry]) => setSimulatorVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(simulator);
    return () => observer.disconnect();
  }, [activeTab]);

  const subscribe = async (): Promise<boolean> => {
    if (subscriptionStatus) {
      window.location.assign("/?app=portfolio");
      return true;
    }
    setSubmitting(true);
    setOrderError("");
    try {
      const walletAddress = await currentWalletAddress();
      const session = await fetch("/api/portfolio", { cache: "no-store" });
      if (!session.ok) throw new Error("Your private portfolio session could not be started");
      const response = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(walletAddress ? { "x-ganymede-wallet": walletAddress } : {}) },
        body: JSON.stringify({ productId: etf.id, amountKrw, walletAddress, clientReference: crypto.randomUUID() }),
      });
      const payload = await response.json() as { subscription?: { status?: string }; error?: string; code?: string };
      if (response.status === 400 && payload.code === "INVALID_REQUEST") {
        // The ledger refused the request, so nothing was saved and its reason is safe to show.
        setOrderError(`${payload.error ?? "The request was not accepted"}. Nothing was saved.`);
        return false;
      }
      if (!response.ok) throw new Error(payload.error || "Subscription request failed");
      setSubscriptionStatus(payload.subscription?.status ?? "submitted");
      return true;
    } catch {
      setOrderError("We couldn’t confirm that your simulation was saved. Your amount is kept here. Check your portfolio before retrying to avoid saving it twice.");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={`product-detail-page ganymede-v4 product-${etf.id}`}>
      <SiteHeader current="portfolio" />
      <aside className="strategy-context"><Link href="/lab#paper-strategy-lab" prefetch={false}>← Paper strategy lab</Link><span>Crypto simulation · Separate from the USTX stock basket</span><a href="/proof">Inspect USTX NAV ↗</a></aside>

      <div className="chain-testnet-notice"><span><i /> PRE-LAUNCH TEST ENVIRONMENT</span><p>{DEFAULT_SETTLEMENT_CHAIN.name} · Chain ID {DEFAULT_SETTLEMENT_CHAIN.chainId} · Simulated fund-share registry</p><a href={DEFAULT_SETTLEMENT_CHAIN.explorerUrl} target="_blank" rel="noreferrer">OPEN EXPLORER ↗</a></div>

      <section className="product-detail-hero" aria-labelledby="detail-product-name">
        <div className="product-detail-copy">
          <Link href="/lab#paper-strategy-lab" className="detail-back">← All strategies</Link>
          <div className="product-detail-labels"><span>{etf.roleName} / {etf.ticker}</span><b className={`strategy-style-badge strategy-${etf.strategyStyle}`}>{etf.strategyStyle.toUpperCase()}</b></div>
          <h1 id="detail-product-name">{etf.name}</h1>
          <h2>{etf.tagline}</h2>
          <p>{etf.whyChoose}</p>
          <div className="product-hero-actions"><button type="button" onClick={subscriptionStatus ? () => window.location.assign("/?app=portfolio") : openSubscription}>{subscriptionStatus ? "View paper portfolio" : "Try a sample amount"}</button><button type="button" onClick={() => openInformation("methodology")}>See how it works</button></div>
          <dl className="product-hero-facts"><div><dt>ANNUAL FEE</dt><dd>{etf.fee}</dd></div><div><dt>RISK</dt><dd>{etf.risk}</dd></div><div><dt>REBALANCE</dt><dd>{etf.rebalanceFrequency}</dd></div></dl>
        </div>

        <div className="product-market-data">
          <div className="detail-nav-planet" aria-hidden="true"><StrategyGlyph variant={etf.visual} compact /></div>
          <span>INDICATIVE FUND DATA / {marketError && liveProduct?.nav ? "LAST LOADED" : liveProduct?.nav?.quality?.toUpperCase() ?? (marketLoading ? "LOADING" : "UNAVAILABLE")}</span>
          <div className="product-nav"><small>INDICATIVE NAV / KRW</small><b>{formatNav(liveProduct?.nav?.navPerShareMicros, "—")}</b><em>{liveProduct?.status?.toUpperCase() ?? (marketLoading ? "LOADING DATA" : "DATA UNAVAILABLE")}</em></div>
          <p className="product-nav-time">AS OF {liveProduct?.nav?.asOf ? new Date(liveProduct.nav.asOf).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }) : "AWAITING DATA"}</p>
          <dl><div><dt>MODEL AUM</dt><dd>{liveProduct?.nav ? formatKrw(liveProduct.nav.netAssetValueKrw) : "—"}</dd></div><div><dt>TARGET POSITIONS</dt><dd>{liveProduct?.targets?.length ? livePositionCount : etf.assetCount}</dd></div></dl>
        </div>
      </section>

      {marketError && <div className="detail-data-notice"><DataNotice title={liveProduct?.nav ? "NAV refresh is unavailable." : "Pricing is temporarily unavailable."} onRetry={() => setReloadKey((key) => key + 1)} loading={marketLoading}>{liveProduct?.nav ? "Showing the last loaded values. Estimates may change when pricing returns." : "You can still explore this strategy and enter a sample amount. Share estimates and saving will be available when pricing returns."}</DataNotice></div>}

      <ProductTabs active={activeTab} onChange={setActiveTab} />

      <section key={activeTab} id={`product-panel-${activeTab}`} role="tabpanel" aria-labelledby={`product-tab-${activeTab}`} className="product-tab-panel is-entering">
        {activeTab === "overview" && <OverviewPanel etf={etf} liveProduct={liveProduct} engineMode={engineMode} amountKrw={amountKrw} subscriptionStatus={subscriptionStatus} submitting={submitting} orderError={orderError} onAmountChange={(value) => { setAmountKrw(value); setOrderError(""); }} onHoldings={() => openInformation("holdings")} onSubscribe={subscriptionStatus ? () => { void subscribe(); } : () => { if (estimatePaperAllocation(amountKrw, liveProduct?.nav?.navPerShareMicros, etf.fee).shares !== null) setReviewOpen(true); }} />}
        {activeTab === "performance" && <PerformancePanel etf={etf} />}
        {activeTab === "holdings" && <HoldingsPanel etf={etf} liveProduct={liveProduct} />}
        {activeTab === "methodology" && <MethodologyPanel etf={etf} />}
        {activeTab === "documents" && <DocumentsPanel etf={etf} />}
      </section>

      <button type="button" className={`mobile-allocation-cta${simulatorVisible ? " is-hidden" : ""}`} onClick={subscriptionStatus ? () => window.location.assign("/?app=portfolio") : openSubscription}><span>{subscriptionStatus ? "PAPER PORTFOLIO" : "TRY A SAMPLE"}</span><b>{subscriptionStatus ? "VIEW SAVED ALLOCATION" : formatKrw(amountKrw)}</b></button>

      {reviewOpen && <SimulationReviewDialog etf={etf} amountKrw={amountKrw} nav={liveProduct?.nav?.navPerShareMicros ?? ""} submitting={submitting} error={orderError} onCancel={() => { if (!submitting) setReviewOpen(false); }} onConfirm={() => { void subscribe().then((saved) => { if (saved) setReviewOpen(false); }); }} />}

      <SiteFooter />
    </main>
  );
}
