"use client";

import Link from "next/link";
import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import BasketOverview from "./BasketOverview";
import NavPreview from "./NavPreview";
import PortfolioView from "./PortfolioView";
import DataNotice from "./DataNotice";
import type { PortfolioData, PortfolioPosition } from "@/lib/portfolio-display";
import { Arrow, SiteFooter, StockMark, StrategyGlyph } from "./DesignElements";
import { XSTOCKS_CONSTITUENTS } from "@/lib/xstocks/basket";
import SiteHeader from "./SiteHeader";
import { etfs, type Etf, type Filter } from "./data/etfs";

type View = "select" | "portfolio" | "operations";

type MarketProduct = {
  id: string;
  slug: string;
  ticker: string;
  name: string;
  strategyStyle: "passive" | "active";
  status: string;
  nav: null | {
    navPerShareMicros: string;
    netAssetValueKrw: string;
    sharesOutstandingMicros: string;
    asOf: string;
    quality: string;
  };
  targets: Array<{ symbol: string; target_weight_bps: number; rationale: string; effective_at: string }>;
  lastRebalance: null | Record<string, unknown>;
};

type MarketOverview = {
  products: MarketProduct[];
  lastCycle: null | {
    cycleId: string;
    mode: "paper" | "live";
    completedAt: string;
    marketDataQuality: "live" | "reference" | "mixed";
    ordersCreated: number;
    warnings: string[];
  };
  updatedAt: string | null;
};

type OperationsData = {
  actor?: string;
  error?: string;
  lastCycle: MarketOverview["lastCycle"];
  lastCycleAt: string | null;
  counts: {
    operational_products?: number;
    open_orders?: number;
    open_subscriptions?: number;
    open_redemptions?: number;
    pending_settlements?: number;
  };
  recentOrders: Array<Record<string, unknown>>;
  recentRebalances: Array<Record<string, unknown>>;
  recentSettlements: Array<Record<string, unknown>>;
};

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "passive", label: "PASSIVE" },
  { id: "active", label: "ACTIVE" },
];


function asNumber(value: string | number | bigint | null | undefined): number {
  try {
    return Number(BigInt(value ?? 0));
  } catch {
    return 0;
  }
}

function formatKrw(value: string | number | bigint): string {
  return `₩${asNumber(value).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
}

function formatNav(value: string): string {
  return `₩${(asNumber(value) / 1_000_000).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const normalized = value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

async function currentWalletAddress(): Promise<string | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

function StrategyArt({ variant }: { variant: Etf["visual"] }) {
  return <StrategyGlyph variant={variant} compact />;
}

function EtfCard({ etf, liveProduct, dataState, onOpen, onNavigate }: {
  etf: Etf;
  liveProduct?: MarketProduct;
  dataState: "loading" | "ready" | "error";
  onOpen: (id: string) => void;
  onNavigate: (id: string, direction: number) => void;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onNavigate(etf.id, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onNavigate(etf.id, -1);
    }
  };
  const allTargetHoldings = liveProduct?.targets?.length ? liveProduct.targets : etf.basket.map((holding) => ({ symbol: holding.ticker, target_weight_bps: holding.weight * 100 }));
  const targetHoldings = allTargetHoldings.slice(0, 3);
  return (
    <article className={`etf-card etf-product-card product-${etf.id}`}>
      <a id={`etf-card-${etf.id}`} className="etf-card-hit" href={`/etfs/${etf.slug}`} aria-label={`View ${etf.name}, ${etf.roleName}, ${etf.risk.toLowerCase()} risk, product details`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(etf.id); }} onKeyDown={handleKeyDown} />
      <div className="product-card-index" aria-hidden="true"><span>{String(etfs.findIndex((candidate) => candidate.id === etf.id) + 1).padStart(2, "0")}</span><i /></div>
      <div className="etf-card-hero">
        <div className="etf-card-copy">
          <span className="product-role-name">{etf.portfolioRole}</span>
          <div className="product-card-labels">
            <span className="etf-ticker">{etf.ticker}</span>
            <span className={`strategy-style-badge strategy-${etf.strategyStyle}`}>{etf.strategyStyle.toUpperCase()}</span>
            <span className={`risk-badge risk-${etf.risk.toLowerCase()}`} data-risk={etf.risk}>{etf.risk} RISK</span>
          </div>
          <h2>{etf.name}</h2>
          <p>{etf.tagline}</p>
          <small>{etf.rebalanceFrequency} REBALANCE · {liveProduct?.targets?.length || etf.assetCount} ASSETS</small>
        </div>
        <StrategyArt variant={etf.visual} />
      </div>
      <dl className="etf-metrics product-card-metrics">
        <div><dt>INDICATIVE NAV / KRW</dt><dd>{liveProduct?.nav ? formatNav(liveProduct.nav.navPerShareMicros) : "—"}<small>{dataState === "error" && liveProduct?.nav ? "LAST LOADED" : liveProduct?.nav?.quality?.toUpperCase() ?? (dataState === "loading" ? "LOADING" : "UNAVAILABLE")}</small></dd></div>
        <div><dt>ANNUAL FEE</dt><dd>{etf.fee}</dd></div>
        <div><dt>Rebalance</dt><dd className="metric-text">{etf.rebalanceFrequency}</dd></div>
      </dl>
      <div className="etf-card-actions">
        <div className="holding-chips" aria-label="Top target holdings">
          {targetHoldings.map((holding) => <span key={holding.symbol}>{holding.symbol} <b>{(holding.target_weight_bps / 100).toFixed(1)}%</b></span>)}
          {allTargetHoldings.length > 3 && <span className="holding-more">+{allTargetHoldings.length - 3}</span>}
        </div>
        <span className="select-etf-button" aria-hidden="true">View strategy <span>↗</span></span>
      </div>
    </article>
  );
}

function OperationsView({ data, loading, error, onRun }: { data: OperationsData | null; loading: boolean; error: string; onRun: () => Promise<void> }) {
  const cycle = data?.lastCycle;
  const rows = data?.recentOrders ?? [];
  if (!data) return <main className="operations-page"><header className="operations-header"><div><p className="section-kicker">Operator workspace</p><h1>Fund operations</h1><p>Execution, settlement and the latest engine cycle.</p></div></header><DataNotice title={error ? "Operator access is unavailable." : "Loading operations."}>{error ? "This workspace requires an authorized operator. Public NAV evidence and the strategy collection remain available." : "Reading the latest operational snapshot."}</DataNotice><a className="button" href="/proof">Inspect public NAV evidence <Arrow /></a></main>;
  return (
    <main className="portfolio-page operations-page">
      <header className="portfolio-header operations-header">
        <div><p className="section-kicker">AUTHORIZED CONTROL ROOM / PAPER ENVIRONMENT</p><h1>Fund operations observatory</h1><p>Exception-first monitoring for strategy, NAV, rebalance, order, settlement and audit cycles.</p></div>
        <button type="button" className="portfolio-browse-button" disabled={loading} onClick={onRun}>{loading ? "RUNNING…" : "RUN CONTROLLED CYCLE"}</button>
      </header>
      <dl className="portfolio-kpis operations-kpis">
        <div><dt>ENGINE MODE</dt><dd>{cycle?.mode?.toUpperCase() ?? "PAPER"}</dd><small>{cycle?.marketDataQuality?.toUpperCase() ?? "WAITING FOR DATA"}</small></div>
        <div><dt>PRODUCTS</dt><dd>{String(data?.counts?.operational_products ?? 4).padStart(2, "0")}</dd><small>02 passive · 02 active</small></div>
        <div><dt>OPEN ORDERS</dt><dd>{String(data?.counts?.open_orders ?? 0).padStart(2, "0")}</dd><small>{cycle?.ordersCreated ?? 0} created last cycle</small></div>
        <div><dt>SETTLEMENT QUEUE</dt><dd>{String(data?.counts?.pending_settlements ?? 0).padStart(2, "0")}</dd><small>Mint · burn · NAV · rebalance</small></div>
      </dl>
      <section className="operations-workspace">
        <article className="operations-cycle-card">
          <span>LAST ENGINE CYCLE</span>
          <h2>{cycle ? "Cycle completed" : "Awaiting first cycle"}</h2>
          <dl>
            <div><dt>COMPLETED</dt><dd>{displayTime(cycle?.completedAt ?? data?.lastCycleAt)}</dd></div>
            <div><dt>STRATEGIES</dt><dd>{cycle ? "04 EVALUATED" : "—"}</dd></div>
            <div><dt>ORDERS</dt><dd>{cycle?.ordersCreated ?? 0}</dd></div>
            <div><dt>AUTHORITY</dt><dd>{data?.actor ?? "PRIVATE OPERATOR"}</dd></div>
          </dl>
          <p>{error || data?.error || cycle?.warnings?.[0] || "No engine warnings were recorded in the latest cycle."}</p>
        </article>
        <article className="operations-order-card">
          <header><div><span>RECENT VENUE ORDERS</span><h2>Execution ledger</h2></div><b>UPBIT</b></header>
          <div className="operations-order-table">
            <div className="operations-order-row is-head"><span>PRODUCT</span><span>ASSET</span><span>SIDE</span><span>NOTIONAL</span><span>STATE</span></div>
            {rows.length ? rows.slice(0, 8).map((row) => <div className="operations-order-row" key={String(row.id)}><span>{String(row.product_id)}</span><span>{String(row.symbol)}</span><span>{String(row.side).toUpperCase()}</span><span>{formatKrw(String(row.requested_notional_krw ?? 0))}</span><span>{String(row.status).toUpperCase()}</span></div>) : <p className="operations-empty-log">No orders recorded yet. The first approved rebalance will populate this ledger.</p>}
          </div>
        </article>
      </section>
    </main>
  );
}

function useDialogFocus(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    getFocusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
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
  }, [onClose]);

  return dialogRef;
}

function ChoiceGuide({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const titleId = useId();
  const copyId = useId();
  const dialogRef = useDialogFocus(onClose);
  const options = [
    ["core-20", "BUILD A CORE POSITION", "Start with GMD CORE", "A rules-based foundation for broad digital-asset exposure."],
    ["digital-income", "REDUCE VOLATILITY", "Start with GMD YIELD", "A lower-risk stabilizer designed for steadier participation."],
    ["tech-leaders", "TARGET INFRASTRUCTURE GROWTH", "Start with GMD TECH", "Focused exposure to networks building digital infrastructure."],
    ["next-frontier", "EXPLORE EMERGING NETWORKS", "Start with GMD ALPHA", "A higher-risk strategy for early-stage network growth."],
  ];
  return (
    <div className="confirm-backdrop choice-guide-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} className="choice-guide-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={copyId}>
        <header><div><span>20-SECOND STRATEGY FINDER</span><h2 id={titleId}>What should this strategy do in your portfolio?</h2><p id={copyId}>Choose one goal. You can still compare all four strategies at any time.</p></div><button type="button" className="choice-guide-close" onClick={onClose} aria-label="Close strategy finder">×</button></header>
        <div className="choice-guide-options">
          {options.map(([id, goal, title, copy], index) => <button key={id} type="button" className={`product-${id}`} onClick={() => onOpen(id)}><i>{String(index + 1).padStart(2, "0")}</i><span>{goal}</span><b>{title}</b><small>{copy}</small><em>View strategy ↗</em></button>)}
        </div>
        <div className="plain-language-guide"><span>TERMS, MADE SIMPLE</span><dl><div><dt>PASSIVE</dt><dd>Follows published rules and changes holdings at scheduled reviews.</dd></div><div><dt>ACTIVE</dt><dd>Uses systematic signals to adjust holdings within fixed limits.</dd></div><div><dt>INDICATIVE NAV</dt><dd>An estimate of one fund share’s value, not an independently verified price.</dd></div><div><dt>MODEL RETURN</dt><dd>A simulated result, not money earned by investors.</dd></div></dl></div>
        <footer><button type="button" onClick={onClose}>COMPARE ALL FOUR</button><p>PAPER MODE means no real order is placed and no money moves.</p></footer>
      </section>
    </div>
  );
}

function ConfirmDialog({ eyebrow, title, copy, confirmLabel, danger = false, onCancel, onConfirm }: {
  eyebrow: string;
  title: string;
  copy: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const copyId = useId();
  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={copyId}>
        <span>{eyebrow}</span>
        <h2 id={titleId}>{title}</h2>
        <p id={copyId}>{copy}</p>
        <div><button type="button" onClick={onCancel}>Keep it</button><button type="button" className={danger ? "is-danger" : "is-primary"} onClick={onConfirm}>{confirmLabel}</button></div>
      </section>
    </div>
  );
}

export default function HomeClient({ initialView }: { initialView: View | "overview" }) {
  const [appOpen, setAppOpen] = useState(initialView !== "overview");
  const [view, setView] = useState<View>(initialView === "overview" ? "select" : initialView);
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [operations, setOperations] = useState<OperationsData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [marketError, setMarketError] = useState("");
  const [portfolioError, setPortfolioError] = useState("");
  const [operationsError, setOperationsError] = useState("");
  const [pendingRedeem, setPendingRedeem] = useState<PortfolioPosition | null>(null);
  const [confirmCycle, setConfirmCycle] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  const openView = useCallback((nextView: View) => {
    setAppOpen(true);
    setView(nextView);
    if (window.location.search !== `?app=${nextView}`) window.history.pushState({ ganymedeView: nextView }, "", `/?app=${nextView}`);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }, []);

  const openOverview = useCallback(() => {
    setAppOpen(false);
    if (window.location.search) window.history.pushState({ ganymedeView: "overview" }, "", "/");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }, []);

  const visibleEtfs = useMemo(() => activeFilter === "all" ? etfs : etfs.filter((etf) => etf.strategyStyle === activeFilter), [activeFilter]);
  const marketById = useMemo(() => new Map((market?.products ?? []).map((product) => [product.id, product])), [market]);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      const payload = await response.json() as MarketOverview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Market engine is unavailable");
      setMarket(payload);
      setMarketError("");
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : "Market engine is unavailable");
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const refreshPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    try {
      const walletAddress = await currentWalletAddress();
      const response = await fetch("/api/portfolio", { cache: "no-store", headers: walletAddress ? { "x-ganymede-wallet": walletAddress } : undefined });
      const payload = await response.json() as PortfolioData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Portfolio ledger is unavailable");
      setPortfolio(payload);
      setPortfolioError("");
      setRemoveError("");
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : "Portfolio ledger is unavailable");
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  const refreshOperations = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const response = await fetch("/api/operations/status", { cache: "no-store" });
      const payload = await response.json() as OperationsData;
      if (!response.ok) throw new Error(payload.error || "Operations authorization is required");
      setOperations(payload);
      setOperationsError("");
    } catch (error) {
      setOperationsError(error instanceof Error ? error.message : "Operations are unavailable");
    } finally {
      setOperationsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const savedFilter = sessionStorage.getItem("ganymede-etf-filter") as Filter | null;
      if (savedFilter && filters.some((filter) => filter.id === savedFilter)) setActiveFilter(savedFilter);
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  useEffect(() => {
    const restoreFromUrl = () => {
      const appView = new URLSearchParams(window.location.search).get("app");
      if (appView === "select" || appView === "portfolio" || appView === "operations") {
        setAppOpen(true);
        setView(appView);
      } else {
        setAppOpen(false);
      }
    };
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, []);

  useEffect(() => {
    if (!appOpen || view !== "select") return;
    const initial = window.setTimeout(() => void refreshMarket(), 0);
    const timer = window.setInterval(refreshMarket, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [appOpen, view, refreshMarket]);

  useEffect(() => {
    if (!appOpen) return;
    const initial = window.setTimeout(() => {
      if (view === "portfolio") void refreshPortfolio();
      if (view === "operations") void refreshOperations();
    }, 0);
    return () => window.clearTimeout(initial);
  }, [appOpen, view, refreshOperations, refreshPortfolio]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  const openEtfDetail = (id: string) => {
    const etf = etfs.find((candidate) => candidate.id === id);
    if (!etf) return;
    sessionStorage.setItem("ganymede-etf-filter", activeFilter);
    window.location.assign(`/etfs/${etf.slug}`);
  };

  const navigateCards = (id: string, direction: number) => {
    const currentIndex = visibleEtfs.findIndex((etf) => etf.id === id);
    const nextIndex = (currentIndex + direction + visibleEtfs.length) % visibleEtfs.length;
    requestAnimationFrame(() => document.getElementById(`etf-card-${visibleEtfs[nextIndex].id}`)?.focus());
  };

  const redeemPosition = async (position: PortfolioPosition) => {
    setRemoving(true);
    setRemoveError("");
    try {
      const walletAddress = await currentWalletAddress();
      const response = await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(walletAddress ? { "x-ganymede-wallet": walletAddress } : {}) },
        body: JSON.stringify({ productId: position.productId, sharesMicros: position.sharesMicros, walletAddress, clientReference: crypto.randomUUID() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Redemption request failed");
      await refreshPortfolio();
      setActionNotice("Removal request saved. Your allocation will update after processing.");
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Removal could not be confirmed");
    } finally {
      setRemoving(false);
    }
  };

  const runOperationsCycle = async () => {
    setOperationsLoading(true);
    try {
      const response = await fetch("/api/operations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Engine cycle failed");
      await Promise.all([refreshOperations(), refreshMarket()]);
      setActionNotice("Paper engine cycle completed and the indicative data was refreshed.");
    } catch (error) {
      setOperationsError(error instanceof Error ? error.message : "Engine cycle failed");
      setOperationsLoading(false);
    }
  };

  if (appOpen) {
    return (
      <div className="app-shell etf-platform-shell ganymede-v4">
        <SiteHeader current={view === "operations" ? null : view} onNavigate={(next) => next === "overview" ? openOverview() : openView(next)} />
        {view === "select" ? (
          <main className="etf-select-page product-market-page">
            <header className="etf-page-intro product-market-intro">
              <div><p className="section-kicker">The USTX basket</p><h1>Start with what’s inside.</h1><p>Six tokenized US stocks. Inspect their composition, then follow the published NAV to its evidence.</p></div>
              <span className="catalog-environment"><i /> Testnet models</span>
            </header>
            <section className="featured-basket" aria-label="US tech model basket"><div className="featured-basket-copy"><span className="eyebrow">GMD USTX · Stock basket</span><h2>Six companies.<br />One inspectable index.</h2><p>A model basket for exploring transparent NAV reporting. Mainnet prices, with publication evidence on X Layer Testnet.</p><div className="featured-symbols">{XSTOCKS_CONSTITUENTS.map((item) => <StockMark key={item.symbol} symbol={item.symbol} />)}</div><a className="button is-primary" href="/proof">Inspect NAV <Arrow /></a><a className="text-link" href="#ustx-basket">Explore the basket</a></div><NavPreview compact /></section>
            <BasketOverview /><section className="paper-strategy-lab" id="paper-strategy-lab" aria-labelledby="paper-lab-title"><div className="collection-heading"><div><h2 id="paper-lab-title">Paper strategy lab</h2><p>Four digital-asset simulations, separate from the USTX basket and its NAV evidence. Compare strategies and save sample allocations.</p></div><span>Simulation only</span></div>
            <div className="product-market-toolbar">
              <div className="etf-filters strategy-filters" role="group" aria-label="Filter ETF strategies">{filters.map((filter) => <button key={filter.id} type="button" className={activeFilter === filter.id ? "is-active" : ""} aria-pressed={activeFilter === filter.id} onClick={() => { setActiveFilter(filter.id); sessionStorage.setItem("ganymede-etf-filter", filter.id); }}>{filter.label}</button>)}</div>
              <div className="market-toolbar-status"><button type="button" className="choice-guide-trigger" onClick={() => setGuideOpen(true)}>Help me choose <span>?</span></button><p aria-live="polite" aria-atomic="true">{marketError ? market ? "Showing last loaded NAV" : "NAV unavailable" : market?.updatedAt ? `NAV updated ${displayTime(market.updatedAt)}` : "Loading indicative NAV…"}</p></div>
            </div>
            <>{marketError && <DataNotice title={market ? "NAV refresh is unavailable." : "Prices are temporarily unavailable."} onRetry={() => void refreshMarket()} loading={marketLoading}>{market ? "The values below are from the last successful load. You can still compare strategy details." : "You can still compare each strategy’s role, risk and fee. Share estimates will return when pricing is available."}</DataNotice>}</>
            <section key={activeFilter} className="etf-card-grid is-filtered" aria-label="Paper strategies">{visibleEtfs.map((etf) => <EtfCard key={etf.id} etf={etf} liveProduct={marketById.get(etf.id)} dataState={marketError ? "error" : market ? "ready" : "loading"} onOpen={openEtfDetail} onNavigate={navigateCards} />)}</section></section>
          </main>
        ) : view === "portfolio" ? (
          <PortfolioView data={portfolio} loading={portfolioLoading} error={portfolioError} actionError={removeError} removing={removing} onRetry={() => void refreshPortfolio()} onBrowse={() => window.location.assign("/?app=select#paper-strategy-lab")} onOpen={(position) => window.location.assign(`/etfs/${position.slug}`)} onRedeem={(position) => setPendingRedeem(position)} />
        ) : (
          <OperationsView data={operations} loading={operationsLoading} error={operationsError} onRun={async () => setConfirmCycle(true)} />
        )}
        <SiteFooter />
        {pendingRedeem && <ConfirmDialog eyebrow="PAPER PORTFOLIO / REVIEW" title={`Remove ${pendingRedeem.ticker} from this simulation?`} copy="This requests removal of your saved paper allocation. It remains visible until processing is complete. No real shares, assets or funds will be affected." confirmLabel="Remove" danger onCancel={() => setPendingRedeem(null)} onConfirm={() => { const position = pendingRedeem; setPendingRedeem(null); void redeemPosition(position); }} />}
        {confirmCycle && <ConfirmDialog eyebrow="CONTROL ROOM / PAPER MODE" title="Run one controlled engine cycle?" copy="The paper engine will evaluate four strategies, refresh indicative NAV, create any simulated rebalance orders and append the results to the audit ledger." confirmLabel="RUN PAPER CYCLE" onCancel={() => setConfirmCycle(false)} onConfirm={() => { setConfirmCycle(false); void runOperationsCycle(); }} />}
        {guideOpen && <ChoiceGuide onClose={() => setGuideOpen(false)} onOpen={(id) => { setGuideOpen(false); openEtfDetail(id); }} />}
        {actionNotice && <div className="action-toast" role="status"><i>✓</i><p>{actionNotice}</p><button type="button" onClick={() => setActionNotice("")} aria-label="Dismiss notification">×</button></div>}
      </div>
    );
  }

  return (
    <div className="ganymede-launch etf-platform-launch ganymede-v4">
      <SiteHeader current="overview" onNavigate={(next) => next === "overview" ? openOverview() : openView(next)} />
      <main aria-labelledby="hero-title">
      <div className="launch-layout">
      <section className="launch-copy etf-launch-copy">
        <h1 id="hero-title">An index you<br />can inspect.</h1>
        <p className="launch-description">For basket operators sharing NAV evidence and analysts checking it. Six US tech xStocks, with the calculation and published record open to inspection.</p>
        <div className="launch-actions"><Link className="button is-primary" href="/?app=select" prefetch={false}>Explore USTX <Arrow /></Link><a className="button" href="/proof">Inspect NAV</a></div>
        <div className="launch-status-line"><span className="badge badge-blue">X Layer Testnet</span><span className="badge badge-sand">Model basket</span></div>
      </section>
      <div className="launch-observatory"><div className="hero-sculpture"><img src="/images/clearform-stack.webp" width="1024" height="1024" fetchPriority="high" alt="Six translucent layers representing the Apple, Microsoft, NVIDIA, Amazon, Meta and Tesla xStocks in the basket" /></div><NavPreview /></div>
      </div>
      <section className="home-basket" aria-labelledby="home-basket-title"><header><h2 id="home-basket-title">Inside GMD USTX</h2><span>Equal weight at fixing</span></header><ul className="launch-constituents" aria-label="Basket constituents">{XSTOCKS_CONSTITUENTS.map((item) => <li key={item.symbol}><StockMark symbol={item.symbol} /><div><b>{item.symbol}</b><span>{item.name === "Meta Platforms" ? "Meta" : item.name}</span></div></li>)}</ul><a className="evidence-callout" href="/proof"><span className="evidence-symbol" aria-hidden="true">≋</span><span><strong>See how NAV is calculated</strong><small>Inspect the basket, its calculation and the record on X Layer.</small></span><Arrow /></a></section>
      <section className="launch-evidence-path" aria-label="How to inspect the evidence">
        <div><span>01 · The basket</span><h2>Know what’s inside.</h2><p>Six disclosed holdings. See the units and prices behind each model share.</p></div>
        <div><span>02 · The record</span><h2>Trace the published value.</h2><p>A timestamped NAV and composition hash, recorded on X Layer Testnet.</p></div>
        <div><span>03 · The evidence</span><h2>Check it for yourself.</h2><p>Your browser compares the document, its hash and the recorded NAV.</p></div>
      </section>
      <aside className="launch-fund-index" aria-label="Fund universe">
        <span className="launch-fund-index-label">ALSO EXPLORE<span>Paper strategy lab</span><small>Digital-asset strategies · Simulations</small></span>
        {etfs.map((etf, index) => <button key={etf.id} type="button" className={`product-${etf.id}`} onClick={() => openEtfDetail(etf.id)}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{etf.ticker.replace("GMD ", "")}</b><small>{etf.portfolioRole}</small></span><em aria-hidden="true">↗</em></button>)}
      </aside>
      </main><SiteFooter />
      {guideOpen && <ChoiceGuide onClose={() => setGuideOpen(false)} onOpen={(id) => { setGuideOpen(false); openEtfDetail(id); }} />}
    </div>
  );
}
