"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { FundDetail, FundSummary } from "@/lib/funds/api";
import { fundKind, otherFund, universeToken, type FundDefinition, type FundKind } from "@/lib/funds/catalog";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { PROOF_DEPLOYMENT } from "@/lib/xstocks/proof";
import { verifyFundSnapshot, type FundVerification } from "@/lib/funds/verification";
import { useFundResource } from "./useFundResource";
import type { SeriesPoint } from "@/lib/xstocks/series";
import { AssetMark, Icon, assetStyle } from "./Icons";
import { OkxSource } from "./OkxSource";
import { delayText, useNavDelay } from "./NavDelay";
import MarketChart from "./MarketChart";
import { WeightMeter } from "./ConstituentDrawer";
import { PageGuide } from "./ProductShell";

// The Ganymede funds: a list for Markets, a page for each fund other than USTX (which keeps its own
// page), and the holdings of those funds on Portfolio. Every figure comes from GET /api/v1/funds,
// and each fund page checks its latest record against X Layer in the browser.

const txUrl = (hash: string | null | undefined) => hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${hash}` : null;
const percent = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
const tone = (value: number | null) => value === null || Math.abs(value) < 0.005 ? "" : value > 0 ? " is-up" : " is-down";

/** A line through the recorded NAVs, with the value under the pointer. */
export function NavLine({ series, label, compact = false }: { series: SeriesPoint[]; label: string; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (series.length < 2) return <div className={`gmd-fund-line${compact ? " is-compact" : ""} is-empty`}>{compact ? null : <p className="gmd-caption">The chart starts with the fund&rsquo;s second record.</p>}</div>;
  const width = 600, height = compact ? 48 : 180, pad = compact ? 2 : 8;
  const values = series.map(([, nav]) => Number(nav));
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (index: number) => pad + (index / (series.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const path = series.map(([, nav], index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(Number(nav)).toFixed(1)}`).join("");
  const up = values[values.length - 1] >= values[0];
  if (compact) return <svg className={`gmd-fund-line is-compact${up ? " is-up" : " is-down"}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>;
  const point = hover === null ? null : series[hover];
  return <figure className={`gmd-fund-line${up ? " is-up" : " is-down"}`} aria-labelledby={id}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}
      onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(series.length - 1, Math.round(((event.clientX - box.left) / box.width) * (series.length - 1))))); }}
      onPointerLeave={() => setHover(null)}>
      <path d={path} />
      {point && <><line x1={x(hover!)} x2={x(hover!)} y1={0} y2={height} /><circle cx={x(hover!)} cy={y(Number(point[1]))} r={4} /></>}
    </svg>
    <figcaption id={id}>{point ? <><b>{formatUsdMicros(point[1], 4)}</b> {shortTime(new Date(point[0] * 1000).toISOString())}</> : <>{label}: {formatUsdMicros(String(min), 2)} – {formatUsdMicros(String(max), 2)}</>}</figcaption>
  </figure>;
}

export const KIND_LABELS: Record<FundKind, string> = { basket: "Equity basket", "covered-call": "Covered call fund", autocall: "Autocallable note (ELS)" };

/** The products on Markets, or those of one kind. */
export function FundList({ selectedId, onSelect, controls, kinds, selectable = false }: { selectedId: string; onSelect: (id: string) => void; controls: string; kinds?: FundKind[]; selectable?: boolean }) {
  const delay = useNavDelay();
  const { data, error: failed } = useFundResource<{ funds: FundSummary[] }>("/api/v1/funds");
  const funds = data?.funds?.filter(fund => !kinds || kinds.includes(fundKind(fund.id)));
  return <section className="gmd-fund-list" aria-labelledby="funds-title">
    <header className="gmd-section-heading"><div><h2 id="funds-title">{kinds?.length === 1 ? { basket: "RWA baskets", "covered-call": "Covered-call funds", autocall: "Structured notes" }[kinds[0]] : "All products"}</h2><p>{delay ? "Each priced from xStocks by OKX OnchainOS and normally recorded on X Layer every five minutes; new records are delayed now." : "Each priced from xStocks by OKX OnchainOS and recorded on X Layer every five minutes."}</p></div><span className="gmd-count">{funds ? `${funds.length} ${funds.length === 1 ? "product" : "products"}` : ""}</span></header>
    {failed && <p className="gmd-inline-error" role="status">The funds could not be read just now. Reload the page in a moment.</p>}
    <ul>{(funds ?? []).map(fund => <li key={fund.id} className={selectedId === fund.id ? "is-selected" : undefined}><div className="gmd-fund-row">
      {selectable || fundKind(fund.id) === "basket"
        ? <button type="button" className="gmd-fund-name" aria-pressed={selectedId === fund.id} aria-controls={controls} onClick={() => onSelect(fund.id)}><b>{fund.name}</b><small>{fund.ticker} · {fundKind(fund.id) === "basket" ? `${fund.holdings.length} ${fund.holdings.length === 1 ? "holding" : "holdings"}` : KIND_LABELS[fundKind(fund.id)]}</small></button>
        : <Link prefetch={false} className="gmd-fund-name" href={fund.href}><b>{fund.name}</b><small>{fund.ticker} · {KIND_LABELS[fundKind(fund.id)]}</small></Link>}
      <span className="gmd-fund-marks" aria-hidden="true">{fund.holdings.slice(0, 5).map(holding => <AssetMark key={holding.symbol} symbol={holding.symbol} />)}{fund.holdings.length > 5 && <i>+{fund.holdings.length - 5}</i>}</span>
      <span className="gmd-fund-theme">{fund.theme}</span>
      <NavLine series={fund.series} label={`${fund.name} NAV`} compact />
      <span className="gmd-fund-nav"><b>{fund.nav ? formatUsdMicros(fund.nav.perShareMicros, 2) : "Starting"}</b><small className={tone(fund.changePercent)}>{fund.nav ? `${percent(fund.changePercent)} 7d` : "First record soon"}</small></span>
      <Link prefetch={false} href={fund.href} className="gmd-fund-open" aria-label={`View ${fund.name} details`}><Icon name="arrow" size={18} /></Link>
    </div></li>)}{!funds && !failed && Array.from({ length: 6 }, (_, index) => <li key={index} className="is-loading" aria-hidden="true"><span /></li>)}</ul>
  </section>;
}

export type FundAccount = { cashMicros: string; positions: { fundId: string; sharesMicros: string; costMicros: string }[]; orders: { id: string; fundId: string; side: "subscribe" | "redeem"; usdMicros: string; sharesMicros: string; navMicros: string; createdAt: string }[]; minOrderMicros: string };

/**
 * Never keep one fund's badge for another. The same fund's last check stays while its refreshed
 * response is checked, so its value and order panel do not blank on every refresh.
 */
function useFundCheck(fund: FundDetail | null, fundId: string): FundVerification {
  const [state, setState] = useState<{ fund: FundDetail; fundId: string; check: FundVerification } | null>(null);
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    verifyFundSnapshot(fund, fundId)
      .then(check => { if (!cancelled) setState({ fund, fundId, check }); })
      .catch(() => { if (!cancelled) setState({ fund, fundId, check: { result: "unavailable", detail: "X Layer Testnet could not be read from this browser just now." } }); });
    return () => { cancelled = true; };
  }, [fund, fundId]);
  return fund && state?.fundId === fundId && state.fund.id === fund.id ? state.check : { result: "checking", detail: "Reading the record on X Layer…" };
}

/** The selected fund on Markets uses its own record, history and holdings. */
export function FundMarketPreview({ definition }: { definition: FundDefinition }) {
  const { data, error, reload } = useFundResource<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(definition.id)}`);
  const fund = data?.fund ?? null;
  const check = useFundCheck(fund, definition.id);
  const composition = check.composition ?? null;
  const record = check.record ?? null;
  const loading = !fund && !error;
  const status = error ? "Price unavailable" : check.stale ? "Last NAV checked · delayed" : { matched: "NAV checked on X Layer", checking: "Confirming the price…", failed: "Price needs attention", unavailable: "Price confirmation unavailable" }[check.result];
  const points = (fund?.series ?? []).map(([at, micros]) => ({ at: new Date(at * 1_000).toISOString(), micros, hash: "" }));
  const weights = new Map(composition?.holdings.map(row => [row.symbol, Number(BigInt(row.valueMicros) * 1_000_000n / BigInt(composition.navPerShareMicros)) / 10_000]));
  return <>
    <div className="gmd-market-primary">
      <div className="gmd-feature-title"><div className="gmd-product-identity is-compact"><div className="gmd-product-monogram" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div><span className="gmd-ticker">{definition.ticker} <span>Equity basket</span></span><h2>{definition.name}</h2><p>{definition.description}</p></div></div><Link prefetch={false} className="gmd-button" href={definition.href}>View fund <Icon name="arrow" size={18} /></Link></div>
      <div className="gmd-nav-summary"><div><span className="gmd-label">NAV per share <span>/ USD</span></span><strong className="gmd-value">{record ? formatUsdMicros(record.navPerShareMicros, 4) : loading ? <><i className="gmd-skeleton is-hero" aria-hidden="true" /><span className="gmd-sr-only">Loading</span></> : "—"}</strong></div><div className="gmd-nav-meta"><OkxSource>Priced by OKX OnchainOS</OkxSource><span role="status" className={`gmd-status ${check.result === "matched" && !check.stale ? "is-positive" : "is-waiting"}`}><i />{status}</span>{record && <time dateTime={record.effectiveAt ?? undefined}>{shortTime(record.effectiveAt)}</time>}</div></div>
      {error && <div className="gmd-data-notice" role="status"><span>This fund could not be loaded just now.</span><button type="button" onClick={() => void reload()}>Try again</button></div>}
      <dl className="gmd-fund-stats" aria-label={`${definition.ticker} fund figures`} aria-busy={loading}><div><dt>Assets</dt><dd>{definition.constituents.length}</dd></div><div><dt>Recorded on X Layer</dt><dd>Every 5 minutes</dd></div><div><dt>Investing</dt><dd>Not open yet</dd></div></dl>
      <MarketChart points={points} loading={loading} showActivity={false} historyLabel="Past 7 days" />
      <div className="gmd-feature-bottom"><span>Equal weight <i /> Rebalanced quarterly <i /> Min. $10</span><span className="gmd-badge">Demo fund</span></div>
    </div>
    <div className="gmd-market-composition"><section className="gmd-holdings is-compact gmd-fund-basket" aria-label={`${definition.name} composition`}><header className="gmd-section-heading"><div><h2>The basket</h2><p>{composition ? "Weights at the latest OKX OnchainOS prices" : "Holdings in this fund"}</p></div><span className="gmd-count">{definition.constituents.length} assets</span></header>
      {composition && <div className="gmd-composition-strip" aria-hidden="true">{definition.constituents.map(symbol => <span key={symbol} style={{ ...assetStyle(symbol), flexGrow: weights.get(symbol) ?? 0 }} />)}</div>}
      <div className="gmd-constituents-head" aria-hidden="true"><span>Asset</span><span>Price</span><span>Weight</span></div>
      <ul className="gmd-constituents" aria-label="The xStocks in the basket" aria-busy={loading}>{definition.constituents.map(symbol => {
        const asset = universeToken(symbol)!;
        const row = composition?.holdings.find(item => item.symbol === symbol);
        const weight = weights.get(symbol);
        return <li key={symbol} style={assetStyle(symbol)}><div className="gmd-constituent"><AssetMark symbol={symbol} /><span className="gmd-constituent-name"><b>{asset.name}</b><small>{symbol}</small></span><span className="gmd-constituent-price"><b><span className="gmd-sr-only">Price </span>{row ? formatUsdMicros(row.priceMicros, 2) : "—"}</b></span><span className="gmd-constituent-weight"><b><span className="gmd-sr-only">Weight </span>{weight === undefined ? "—" : `${weight.toFixed(2)}%`}</b>{weight !== undefined && <WeightMeter weight={weight} target={100 / definition.constituents.length} />}</span></div></li>;
      })}</ul><p className="gmd-caption">Weights move with prices. The line under each weight marks the equal-weight target.</p>
    </section></div>
  </>;
}

/**
 * The order panel of a product not yet investable: investing runs only on chain, with the demo
 * dollars (dUSD) in a visitor's own wallet on X Layer Testnet, and only USTX has its share token so far.
 */
export function FundClosed({ ticker, note }: { ticker: string; note?: string | null }) {
  const delay = useNavDelay();
  return <aside id="investment" className="gmd-fund-order" aria-labelledby="fund-order-title">
    <h2 id="fund-order-title">Invest in {ticker}</h2>
    <p>{note ?? `Investing in ${ticker} is not open yet. Its value is recorded on X Layer every five minutes, so you can follow it and check it here.`}</p>
    <p className="gmd-caption">Investing runs only on X Layer Testnet, with demo dollars (dUSD) in your own wallet. {delay ? "USTX opens again with the next NAV record; meanwhile only its constant-product pool trades." : "USTX is open now: invest from OKX Wallet, trade it in three pools and borrow against it."}</p>
    <Link className="gmd-button" prefetch={false} href="/products/ustx#investment">Invest in USTX <Icon name="arrow" size={17} /></Link>
  </aside>;
}

/** One fund's page: its NAV and record, its holdings, the browser's check, and investing not open yet. */
export function FundScreen({ id }: { id: string }) {
  const delay = useNavDelay();
  const definition = otherFund(id);
  const { data, error: failed, reload } = useFundResource<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(id)}`);
  const fund = data?.fund ?? null;
  const check = useFundCheck(fund, id);
  useEffect(() => { if (definition) document.title = `${definition.name} (${definition.ticker}) · Ganymede`; }, [definition]);
  const composition = check.composition;
  const poolCheck = check.record && fund?.latest?.publication?.holdingsHash === check.record.holdingsHash ? fund.latest.poolCheck : null;
  if (!definition) return null;
  const nav = check.record?.navPerShareMicros ?? null;
  return <>
    <Link className="gmd-breadcrumb" prefetch={false} href="/"><Icon name="back" size={16} />All funds</Link>
    <div className="gmd-page-heading"><div><span className="gmd-ticker">{definition.ticker} <span>Equity basket</span></span><h1>{definition.name}</h1><p>{definition.description}</p></div><span className="gmd-badge">Demo fund</span></div>
    <PageGuide />
    {failed && <p className="gmd-inline-error" role="status">This fund could not be read just now. Reload the page in a moment.</p>}
    <div className="gmd-fund-layout">
      <div className="gmd-fund-main">
        <section className="gmd-fund-hero" aria-label={`${definition.name} NAV`}>
          <div><span>NAV per share / USD</span><strong>{nav ? formatUsdMicros(nav, 4) : "—"}</strong><small className={tone(fund?.changePercent ?? null)}>{check.record ? `Recorded ${shortTime(check.record.effectiveAt)}${check.stale ? " · delayed" : ""}` : "Waiting for a verified record"}</small></div>
          <div className="gmd-fund-hero-side"><OkxSource>Priced by OKX OnchainOS</OkxSource>{txUrl(fund?.nav?.txHash) && <a className="gmd-inline-tx" href={txUrl(fund?.nav?.txHash)!} target="_blank" rel="noreferrer">Recorded on X Layer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>}</div>
          <NavLine series={fund?.series ?? []} label={`${definition.name} NAV over the last seven days`} />
        </section>
        <section className={`gmd-evidence-summary is-${check.result === "matched" && !check.stale ? "matched" : check.result === "failed" ? "failed" : "waiting"}`} aria-live="polite">
          <div className="gmd-evidence-icon"><Icon name={check.result === "matched" ? "check" : "info"} size={24} /></div>
          <div><h2>{check.stale ? "Last NAV verified on X Layer" : { matched: "NAV verified on X Layer", failed: "This NAV could not be verified", unavailable: "Verification unavailable", checking: "Checking the latest NAV…" }[check.result]}</h2><p>{{ matched: check.stale ? check.detail : "The price and holdings match the published X Layer record.", failed: "The price could not be confirmed. Wait for an updated price before investing.", unavailable: check.detail || "Price confirmation is temporarily unavailable.", checking: "Confirming the latest price and holdings…" }[check.result]}{check.result === "unavailable" && <> <button type="button" className="gmd-inline-link" onClick={() => void reload()}>Try again</button></>}</p>
            {poolCheck && <p className="gmd-caption">{poolCheck.state === "agrees" ? "Pool comparison at publication: within 1% of the basket value." : "A complete pool price comparison was unavailable at publication."}</p>}</div>
        </section>
        <section className="gmd-proof-history" aria-labelledby="fund-holdings-title"><header className="gmd-section-heading"><h2 id="fund-holdings-title">Holdings</h2><span>{definition.constituents.length} xStocks · equal weight each quarter</span></header>
          <div className="gmd-data-table-scroll"><table className="gmd-table gmd-fund-holdings"><thead><tr><th>Asset</th><th>Price</th><th>Value per share</th><th>Weight</th></tr></thead><tbody>
            {definition.constituents.map(symbol => universeToken(symbol)!).map(holding => {
              const row = composition?.holdings.find(item => item.symbol === holding.symbol);
              const weight = row && composition ? Number(BigInt(row.valueMicros) * 10_000n / BigInt(composition.navPerShareMicros)) / 100 : null;
              return <tr key={holding.symbol}><th scope="row"><span className="gmd-fund-asset"><AssetMark symbol={holding.symbol} /><span><b>{holding.name}</b><small>{holding.symbol}</small></span></span></th><td>{row ? formatUsdMicros(row.priceMicros, 2) : "—"}</td><td>{row ? formatUsdMicros(row.valueMicros, 4) : "—"}</td><td>{weight === null ? "—" : `${weight.toFixed(2)}%`}</td></tr>;
            })}
          </tbody></table></div>
        </section>
        <section className="gmd-proof-history" aria-labelledby="fund-records-title"><header className="gmd-section-heading"><h2 id="fund-records-title">Recent records</h2><span>{delay ? `Normally every five minutes; the latest is ${delayText(delay.lateMs)} old` : "A new record every five minutes"}</span></header>
          <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Time</th><th>NAV per share</th><th>Transaction</th></tr></thead><tbody>
            {(fund?.history ?? []).filter(entry => entry.status === "confirmed").slice(0, 8).map(entry => { const link = txUrl(entry.txHash); return <tr key={entry.holdingsHash}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{link ? <a className="gmd-inline-tx" href={link} target="_blank" rel="noreferrer">OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> : "—"}</td></tr>; })}
          </tbody></table>{fund && !fund.history.some(entry => entry.status === "confirmed") && <p className="gmd-caption">No record yet: the first one is written within five minutes of the fund&rsquo;s launch.</p>}</div>
        </section>
        <section className="gmd-terms"><h2>About {definition.ticker}</h2><dl className="gmd-facts">
          <div><dt>Method</dt><dd>Equal weight at each quarterly rebalance; weights move with prices between rebalances</dd></div>
          <div><dt>Prices</dt><dd>OKX OnchainOS, xStocks on X Layer mainnet</dd></div>
          <div><dt>Records</dt><dd>Price history published on X Layer Testnet every five minutes</dd></div>
          <div><dt>How to invest</dt><dd>Not open yet. Investing runs only on X Layer Testnet, from your own wallet; it is open for USTX, with its pools and borrowing</dd></div>
        </dl><p className="gmd-caption">A demo fund on X Layer Testnet. Demo dollars and fund shares have no value, and nothing here is an offer or investment advice.</p></section>
      </div>
      <FundClosed ticker={definition.ticker} />
    </div>
  </>;
}
