import Link from "next/link";
import DataNotice from "./DataNotice";
import { StrategyGlyph } from "./DesignElements";
import { etfs } from "./data/etfs";
import { hasValuation, isPendingRequest, portfolioSummary, type PortfolioData, type PortfolioPosition } from "@/lib/portfolio-display";

const money = (value: string | number) => `₩${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
const time = (value: unknown) => {
  if (typeof value !== "string" || !value) return "Time unavailable";
  const parsed = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
};

export default function PortfolioView({ data, loading, error, actionError, removing, onBrowse, onRetry, onRedeem, onOpen }: {
  data: PortfolioData | null;
  loading: boolean;
  error: string;
  actionError: string;
  removing: boolean;
  onBrowse: () => void;
  onRetry: () => void;
  onRedeem: (position: PortfolioPosition) => void;
  onOpen: (position: PortfolioPosition) => void;
}) {
  const positions = data?.positions ?? [];
  const { invested, value, gain, returnPct } = portfolioSummary(positions);
  const pending = data?.subscriptions.filter(isPendingRequest) ?? [];
  const activity = [
    ...(data?.subscriptions ?? []).map((item): Record<string, unknown> & { kind: string } => ({ ...item, kind: "Allocation" })),
    ...(data?.redemptions ?? []).map((item): Record<string, unknown> & { kind: string } => ({ ...item, kind: "Removal" })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);

  return <main className="portfolio-workspace">
    <header className="portfolio-heading">
      <div><p className="section-kicker">MY PORTFOLIO / STRATEGY LAB</p><h1>Your paper portfolio.</h1><p>Sample allocations are saved for this browser for 30 days. Clearing cookies or using another browser starts a separate portfolio. No real money moves.</p></div>
      <div className="portfolio-heading-actions"><button type="button" className="portfolio-refresh" disabled={loading || removing} onClick={onRetry}>{loading ? "Refreshing…" : "Refresh"} <span aria-hidden="true">↻</span></button><button type="button" className="portfolio-primary" onClick={onBrowse}>Explore strategies <span aria-hidden="true">↗</span></button></div>
    </header>

    <aside className="portfolio-context"><p>This workspace holds crypto strategy simulations. USTX is an inspectable model basket and cannot be purchased or allocated here.</p><Link href="/?app=select#ustx-basket" prefetch={false}>Explore USTX</Link><a href="/proof">Inspect NAV ↗</a></aside>

    {error && data && <DataNotice title="Portfolio refresh is unavailable." onRetry={onRetry} loading={loading}>Showing your last loaded snapshot. Values and request statuses may have changed.</DataNotice>}
    {actionError && !error && <DataNotice title="We couldn’t confirm the removal." onRetry={onRetry} loading={loading}>Refresh your portfolio to check the request before trying again. No real funds move in this simulation.</DataNotice>}

    {!data ? <section className="portfolio-state" aria-busy={loading}>
      <div className="portfolio-state-art" aria-hidden="true"><StrategyGlyph /></div>
      <div><p className="section-kicker">{error ? "TEMPORARILY UNAVAILABLE" : "LOADING YOUR ALLOCATIONS"}</p><h2>{error ? "Your portfolio couldn’t be loaded." : "Bringing your strategies together."}</h2><p>{error ? "We can’t confirm your saved allocations right now. Try again in a moment; you can still explore the strategies." : "Checking saved allocations and their latest available valuations."}</p>{error && <button type="button" className="portfolio-primary" onClick={onRetry} disabled={loading}>{loading ? "Checking…" : "Try again ↻"}</button>}</div>
    </section> : !positions.length ? <section className="portfolio-state">
      <div className="portfolio-state-art" aria-hidden="true"><StrategyGlyph /></div>
      <div><p className="section-kicker">{pending.length ? "ALLOCATION IN PROGRESS" : "ROOM FOR YOUR FIRST STRATEGY"}</p><h2>{pending.length ? "Saved. Waiting to take shape." : "Start with one strategy."}</h2><p>{pending.length ? "Your allocation request is saved. Shares and a valuation will appear once it has been processed. Check its status below." : "Compare a strategy’s role, risk and fee, then save a sample amount to see it here."}</p><button type="button" className="portfolio-primary" onClick={pending.length ? onRetry : onBrowse} disabled={pending.length > 0 && loading}>{pending.length ? loading ? "Checking…" : "Check status ↻" : "Choose a strategy ↗"}</button><p className="portfolio-state-note">01 CHOOSE <span>→</span> 02 TRY AN AMOUNT <span>→</span> 03 SAVE</p></div>
    </section> : <>
      <section className="portfolio-overview" aria-label="Portfolio summary">
        <div className="portfolio-value-card"><span className="portfolio-label">TOTAL SIMULATED VALUE / KRW</span><strong>{value === null ? "—" : money(value)}</strong><p>{value === null ? "A valuation is not yet available for every strategy." : error ? "Last loaded values · refresh unavailable" : "Based on each strategy’s latest recorded NAV"}</p><dl><div><dt>SAMPLE AMOUNT</dt><dd>{money(invested)}</dd></div><div><dt>SIMULATED CHANGE</dt><dd className={gain === null || gain === 0 ? "" : gain > 0 ? "portfolio-gain" : "portfolio-loss"}>{gain === null ? "—" : signedMoney(gain)}{returnPct !== null && <small>{percent(returnPct)}</small>}</dd></div></dl></div>
        <div className="portfolio-mix"><div><span className="portfolio-label">YOUR STRATEGY MIX</span><span>{String(positions.length).padStart(2, "0")} STRATEGIES</span></div><div className="portfolio-allocation-bar" aria-hidden="true">{positions.map((position) => <i key={position.productId} className={`product-${position.productId}`} style={{ flex: Math.max(0, Number(position.costBasisKrw)) }} />)}</div><ul>{positions.map((position) => <li key={position.productId}><i className={`product-${position.productId}`} /><span>{position.ticker}</span><b>{invested > 0 ? `${(Number(position.costBasisKrw) / invested * 100).toFixed(1)}%` : "—"}</b></li>)}</ul><p>Weight by saved sample amount, before valuation changes.</p></div>
      </section>
      <section className="portfolio-allocation-section" aria-labelledby="saved-strategies-title">
        <header><div><p className="section-kicker">SAVED STRATEGIES</p><h2 id="saved-strategies-title">Your paper allocations</h2></div><span>INDICATIVE VALUES · KRW</span></header>
        <div className="portfolio-allocation-grid">{positions.map((position) => {
          const etf = etfs.find((item) => item.id === position.productId);
          const priced = hasValuation(position);
          const pendingRemoval = data.redemptions.some((item) => item.product_id === position.productId && isPendingRequest(item));
          const change = Number(position.unrealizedPnlKrw);
          return <article key={position.productId} className={`portfolio-allocation-card product-${position.productId}`}>
            <header><div><span className="portfolio-label">{etf?.portfolioRole ?? position.strategyStyle.toUpperCase()}</span><h3><a href={`/etfs/${position.slug}`}>{position.ticker} <span aria-hidden="true">↗</span></a></h3><p>{position.name}</p></div><span className="portfolio-style">{position.strategyStyle.toUpperCase()}</span></header>
            <div className="portfolio-position-value"><span className="portfolio-label">SIMULATED VALUE</span><strong>{priced ? money(position.currentValueKrw) : "—"}</strong><span className={!priced || change === 0 ? "" : change > 0 ? "portfolio-gain" : "portfolio-loss"}>{priced ? `${signedMoney(change)} (${percent(position.returnBps / 100)})` : "Awaiting a recorded NAV"}</span></div>
            <dl><div><dt>SAMPLE AMOUNT</dt><dd>{money(position.costBasisKrw)}</dd></div><div><dt>PAPER SHARES</dt><dd>{(Number(position.sharesMicros) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })}</dd></div></dl>
            <p className="portfolio-valuation-time">NAV AS OF {priced ? time(position.navAsOf) : "UNAVAILABLE"}</p>
            <footer><button type="button" onClick={() => onOpen(position)}>View strategy ↗</button><button type="button" className="portfolio-remove" disabled={removing || loading || Boolean(error) || pendingRemoval} onClick={() => onRedeem(position)} aria-label={`${pendingRemoval ? "Removal pending for" : "Remove"} ${position.name}`}>{pendingRemoval ? "Removal pending" : removing ? "Processing…" : "Remove"}</button></footer>
          </article>;
        })}</div>
      </section>
    </>}

    {activity.length > 0 && <details className="portfolio-activity" open={positions.length === 0 || undefined}><summary><span>Recent activity <small>Allocation and removal requests</small></span><span aria-hidden="true">+</span></summary><ul>{activity.map((item) => {
      const status = String(item.status);
      const label = status === "settled" ? "COMPLETED" : status === "rejected" ? "NOT COMPLETED" : status === "cancelled" ? "CANCELLED" : isPendingRequest(item) ? "PROCESSING" : "AWAITING UPDATE";
      return <li key={`${item.kind}-${item.id}`}><div><b>{etfs.find((etf) => etf.id === item.product_id)?.ticker ?? "Strategy"}</b><span>{item.kind}{item.amount_krw ? ` · ${money(String(item.amount_krw))}` : ""}</span></div><time>{time(item.created_at)}</time><span className={`portfolio-activity-status${status === "settled" ? " is-complete" : ""}`}>{label}</span></li>;
    })}</ul></details>}
    <p className="portfolio-footnote">Paper allocations are simulations. Values are indicative, and returns are not investor-earned performance.</p>
  </main>;
}
