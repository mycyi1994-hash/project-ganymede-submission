"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { FundDetail, FundSummary } from "@/lib/funds/api";
import { otherFund } from "@/lib/funds/catalog";
import { formatUsdMicros } from "@/lib/nav-display";
import { DEMO_ORDER_EVENT, formatShares, parseShares } from "@/lib/demo/format";
import { parseUsd } from "@/lib/xstocks/wallet";
import { shortTime } from "@/lib/product-market";
import { PROOF_DEPLOYMENT, verifyFundComposition, type Check } from "@/lib/xstocks/proof";
import { readLatestNav } from "@/lib/xstocks/onchain";
import type { SeriesPoint } from "@/lib/xstocks/series";
import { AssetMark, Icon } from "./Icons";
import { OkxSource } from "./OkxSource";

// The Ganymede funds: a list for Markets, a page for each fund other than USTX (which keeps its own
// page), and the holdings of those funds on Portfolio. Every figure comes from GET /api/v1/funds,
// and each fund page checks its latest record against X Layer in the browser.

const txUrl = (hash: string | null | undefined) => hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${PROOF_DEPLOYMENT.explorerUrl}/tx/${hash}` : null;
const percent = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
const tone = (value: number | null) => value === null || Math.abs(value) < 0.005 ? "" : value > 0 ? " is-up" : " is-down";

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "The funds could not be read just now.");
  return body as T;
}

/** A line through the recorded NAVs, with the value under the pointer. */
function NavLine({ series, label, compact = false }: { series: SeriesPoint[]; label: string; compact?: boolean }) {
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

/** The six funds on Markets. */
export function FundList() {
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readJson<{ funds: FundSummary[] }>("/api/v1/funds").then(body => { if (!cancelled) setFunds(body.funds); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  return <section className="gmd-fund-list" aria-labelledby="funds-title">
    <header className="gmd-section-heading"><div><h2 id="funds-title">All funds</h2><p>Baskets of xStocks, each priced by OKX OnchainOS and recorded on X Layer every five minutes.</p></div><span className="gmd-count">{funds ? `${funds.length} funds` : ""}</span></header>
    {failed && <p className="gmd-inline-error" role="status">The funds could not be read just now. Reload the page in a moment.</p>}
    <ul>{(funds ?? []).map(fund => <li key={fund.id}><Link prefetch={false} href={fund.href}>
      <span className="gmd-fund-name"><b>{fund.name}</b><small>{fund.ticker} · {fund.holdings.length} {fund.holdings.length === 1 ? "holding" : "holdings"}</small></span>
      <span className="gmd-fund-marks" aria-hidden="true">{fund.holdings.slice(0, 5).map(holding => <AssetMark key={holding.symbol} symbol={holding.symbol} />)}{fund.holdings.length > 5 && <i>+{fund.holdings.length - 5}</i>}</span>
      <span className="gmd-fund-theme">{fund.theme}</span>
      <NavLine series={fund.series} label={`${fund.name} NAV`} compact />
      <span className="gmd-fund-nav"><b>{fund.nav ? formatUsdMicros(fund.nav.perShareMicros, 2) : "Starting"}</b><small className={tone(fund.changePercent)}>{fund.nav ? `${percent(fund.changePercent)} 7d` : "First record soon"}</small></span>
      <Icon name="arrow" size={16} />
    </Link></li>)}{!funds && !failed && Array.from({ length: 6 }, (_, index) => <li key={index} className="is-loading" aria-hidden="true"><span /></li>)}</ul>
  </section>;
}

type FundAccount = { cashMicros: string; positions: { fundId: string; sharesMicros: string; costMicros: string }[]; orders: { id: string; fundId: string; side: "subscribe" | "redeem"; usdMicros: string; sharesMicros: string; navMicros: string; createdAt: string }[]; minOrderMicros: string };

function useFundAccount(fundId?: string) {
  const [account, setAccount] = useState<FundAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => readJson<FundAccount>(`/api/funds/account${fundId ? `?fund=${fundId}` : ""}`).then(setAccount).catch(reason => setError(reason instanceof Error ? reason.message : "The demo balance could not be read.")), [fundId]);
  useEffect(() => { void load(); }, [load]);
  return { account, error, reload: load };
}

/** The browser reads the fund's record on X Layer and checks the stored document against it. */
function useFundCheck(fund: FundDetail | null) {
  const [state, setState] = useState<{ result: "matched" | "failed" | "unavailable" | "checking"; detail: string; checks?: { hash: Check; nav: Check } }>({ result: "checking", detail: "Reading the record on X Layer…" });
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId, productKey: fund.productKey });
        if (!record.effectiveAt) { if (!cancelled) setState({ result: "unavailable", detail: "No record of this fund is on X Layer yet." }); return; }
        const entry = fund.history.find(item => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase());
        if (!entry) { if (!cancelled) setState({ result: "unavailable", detail: "A newer record is on X Layer than this page has; reload to check it." }); return; }
        const checks = await verifyFundComposition(entry.canonical, record, fund.id);
        const ok = checks.hash.state === "pass" && checks.nav.state === "pass";
        if (!cancelled) setState({ result: ok ? "matched" : "failed", detail: ok ? "Your browser read this fund's record on X Layer, hashed its holdings document and recalculated the NAV: they match." : "The holdings document does not match the record on X Layer.", checks });
      } catch {
        if (!cancelled) setState({ result: "unavailable", detail: "X Layer Testnet could not be read from this browser just now." });
      }
    })();
    return () => { cancelled = true; };
  }, [fund]);
  return state;
}

function FundOrder({ fund, nav, account, onFilled }: { fund: FundDetail; nav: string | null; account: FundAccount | null; onFilled: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1,000");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const held = BigInt(account?.positions.find(position => position.fundId === fund.id)?.sharesMicros ?? "0");
  const cash = BigInt(account?.cashMicros ?? "0");
  const usd = side === "buy" ? parseUsd(amount) : null;
  const shares = side === "sell" ? parseShares(amount) : null;
  const navMicros = nav ? BigInt(nav) : null;
  const problem = !navMicros ? "This fund has no NAV record yet." : side === "buy"
    ? (usd === null ? "Enter an amount in dollars, such as 1,000." : usd < 10_000_000n ? "The minimum order is $10." : usd > cash ? "That is more than your demo cash." : null)
    : (held === 0n ? "You hold none of this fund yet." : shares === null || shares === 0n ? "Enter a number of shares, up to six decimals." : shares > held ? "That is more than the shares you hold." : null);
  const estimate = navMicros && !problem ? (side === "buy" ? `${formatShares(usd! * 1_000_000n / navMicros)} ${fund.ticker}` : formatUsdMicros(shares! * navMicros / 1_000_000n, 2)) : "—";
  async function submit() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/funds/orders", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(side === "buy" ? { fundId: fund.id, side: "subscribe", usdMicros: usd!.toString(), clientOrderId: crypto.randomUUID() } : { fundId: fund.id, side: "redeem", sharesMicros: shares!.toString(), clientOrderId: crypto.randomUUID() }) });
      const body = await response.json().catch(() => ({})) as { order?: { usdMicros: string; sharesMicros: string; navMicros: string }; error?: string };
      if (!response.ok || !body.order) throw new Error(body.error ?? "The order could not be filled.");
      setMessage({ ok: true, text: side === "buy" ? `Bought ${formatShares(body.order.sharesMicros)} ${fund.ticker} for ${formatUsdMicros(body.order.usdMicros, 2)} at ${formatUsdMicros(body.order.navMicros, 4)}.` : `Redeemed ${formatShares(body.order.sharesMicros)} ${fund.ticker} for ${formatUsdMicros(body.order.usdMicros, 2)} at ${formatUsdMicros(body.order.navMicros, 4)}.` });
      setAmount(side === "buy" ? "1,000" : "");
      onFilled();
      window.dispatchEvent(new Event(DEMO_ORDER_EVENT));
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "The order could not be filled." });
    } finally { setBusy(false); }
  }
  return <aside className="gmd-fund-order" aria-labelledby="fund-order-title">
    <h2 id="fund-order-title">Invest in {fund.ticker}</h2>
    <p className="gmd-caption">With your demo balance: demo dollars with no value, shared with USTX. Orders fill at the NAV recorded on X Layer.</p>
    <div className="gmd-wallet-balances"><div><span>Demo cash</span><b>{account ? formatUsdMicros(account.cashMicros, 2) : "—"}</b><small>no value</small></div><div><span>{fund.ticker} held</span><b>{formatShares(held)}</b><small>{navMicros && held > 0n ? formatUsdMicros(held * navMicros / 1_000_000n, 2) : "shares"}</small></div></div>
    <div className="gmd-segmented" role="group" aria-label="Order type">
      <button type="button" aria-pressed={side === "buy"} onClick={() => { setSide("buy"); setAmount("1,000"); setMessage(null); }}>Buy</button>
      <button type="button" aria-pressed={side === "sell"} onClick={() => { setSide("sell"); setAmount(""); setMessage(null); }}>Redeem</button>
    </div>
    <div className="gmd-order-input">
      <label htmlFor="fund-amount">{side === "buy" ? "You pay" : "Shares to redeem"}</label>
      <div><input id="fund-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={event => { setAmount(event.target.value); setMessage(null); }} aria-invalid={Boolean(problem)} aria-describedby="fund-help" /><span>{side === "buy" ? "USD" : fund.ticker}</span></div>
      <p id="fund-help">{problem ?? (side === "buy" ? `Estimated: ${estimate}` : `Estimated proceeds: ${estimate}`)}</p>
    </div>
    {side === "sell" && held > 0n && <div className="gmd-order-presets" aria-label="Amounts to redeem"><button type="button" onClick={() => setAmount(formatShares(held / 2n).replace(/,/g, ""))}>Half</button><button type="button" onClick={() => setAmount(formatShares(held).replace(/,/g, ""))}>All</button></div>}
    <button type="button" className="gmd-button" disabled={busy || Boolean(problem) || !account} onClick={() => void submit()}>{busy ? "Placing the order…" : side === "buy" ? "Buy with demo dollars" : "Redeem shares"}</button>
    {message && <p className={message.ok ? "gmd-fund-filled" : "gmd-inline-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
  </aside>;
}

/** One fund's page: its NAV and record, its holdings, the browser's check and a demo order. */
export function FundScreen({ id }: { id: string }) {
  const definition = otherFund(id);
  const [fund, setFund] = useState<FundDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const { account, reload } = useFundAccount(id);
  useEffect(() => {
    let cancelled = false;
    readJson<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(id)}`).then(body => { if (!cancelled) setFund(body.fund); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [id]);
  const check = useFundCheck(fund);
  useEffect(() => { if (definition) document.title = `${definition.name} (${definition.ticker}) · Ganymede`; }, [definition]);
  const record = fund?.history.find(entry => entry.status === "confirmed") ?? null;
  const composition = useMemo(() => { try { return record ? JSON.parse(record.canonical) as { holdings: { symbol: string; priceMicros: string; valueMicros: string; unitsWad: string }[]; navPerShareMicros: string } : null; } catch { return null; } }, [record]);
  const poolCheck = fund?.latest?.poolCheck;
  if (!definition) return null;
  const nav = fund?.nav?.perShareMicros ?? null;
  return <>
    <Link className="gmd-breadcrumb" prefetch={false} href="/"><Icon name="back" size={16} />All funds</Link>
    <div className="gmd-page-heading"><div><span className="gmd-ticker">{definition.ticker} <span>Equity basket</span></span><h1>{definition.name}</h1><p>{definition.description}</p></div><span className="gmd-badge">Demo fund</span></div>
    {failed && <p className="gmd-inline-error" role="status">This fund could not be read just now. Reload the page in a moment.</p>}
    <div className="gmd-fund-layout">
      <div className="gmd-fund-main">
        <section className="gmd-fund-hero" aria-label={`${definition.name} NAV`}>
          <div><span>NAV per share / USD</span><strong>{nav ? formatUsdMicros(nav, 4) : "—"}</strong><small className={tone(fund?.changePercent ?? null)}>{fund?.nav ? `${percent(fund.changePercent)} over 7 days · ${shortTime(fund.nav.asOf)}` : "The first record is on its way"}</small></div>
          <div className="gmd-fund-hero-side"><OkxSource>Priced by OKX OnchainOS</OkxSource>{txUrl(fund?.nav?.txHash) && <a className="gmd-inline-tx" href={txUrl(fund?.nav?.txHash)!} target="_blank" rel="noreferrer">Recorded on X Layer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>}</div>
          <NavLine series={fund?.series ?? []} label={`${definition.name} NAV over the last seven days`} />
        </section>
        <section className={`gmd-evidence-summary is-${check.result === "matched" ? "matched" : check.result === "failed" ? "failed" : "waiting"}`} aria-live="polite">
          <div className="gmd-evidence-icon"><Icon name={check.result === "matched" ? "check" : "info"} size={24} /></div>
          <div><h2>{{ matched: "NAV verified on X Layer", failed: "This NAV could not be verified", unavailable: "Verification unavailable", checking: "Checking the latest NAV…" }[check.result]}</h2><p>{check.detail}</p>
            {poolCheck && <p className="gmd-caption">{poolCheck.state === "agrees" ? "Prices agree with the X Layer pools. " : "Not compared with the X Layer pools: "}{poolCheck.detail}</p>}</div>
        </section>
        <section className="gmd-proof-history" aria-labelledby="fund-holdings-title"><header className="gmd-section-heading"><h2 id="fund-holdings-title">Holdings</h2><span>{definition.constituents.length} xStocks · equal weight at each fixing</span></header>
          <div className="gmd-data-table-scroll"><table className="gmd-table gmd-fund-holdings"><thead><tr><th>Asset</th><th>Price</th><th>Value per share</th><th>Weight</th></tr></thead><tbody>
            {(fund?.holdings ?? definition.constituents.map(symbol => ({ symbol, name: symbol, kind: "stock" as const }))).map(holding => {
              const row = composition?.holdings.find(item => item.symbol === holding.symbol);
              const weight = row && composition ? Number(BigInt(row.valueMicros) * 10_000n / BigInt(composition.navPerShareMicros)) / 100 : null;
              return <tr key={holding.symbol}><th scope="row"><span className="gmd-fund-asset"><AssetMark symbol={holding.symbol} /><span><b>{holding.name}</b><small>{holding.symbol}</small></span></span></th><td>{row ? formatUsdMicros(row.priceMicros, 2) : "—"}</td><td>{row ? formatUsdMicros(row.valueMicros, 4) : "—"}</td><td>{weight === null ? "—" : `${weight.toFixed(2)}%`}</td></tr>;
            })}
          </tbody></table></div>
        </section>
        <section className="gmd-proof-history" aria-labelledby="fund-records-title"><header className="gmd-section-heading"><h2 id="fund-records-title">Recent records</h2><span>A new record every five minutes</span></header>
          <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Time</th><th>NAV per share</th><th>Transaction</th></tr></thead><tbody>
            {(fund?.history ?? []).filter(entry => entry.status === "confirmed").slice(0, 8).map(entry => { const link = txUrl(entry.txHash); return <tr key={entry.holdingsHash}><th scope="row">{shortTime(entry.asOf)}</th><td>{formatUsdMicros(entry.navPerShareMicros, 4)}</td><td>{link ? <a className="gmd-inline-tx" href={link} target="_blank" rel="noreferrer">OKX Explorer<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a> : "—"}</td></tr>; })}
          </tbody></table>{fund && !fund.history.some(entry => entry.status === "confirmed") && <p className="gmd-caption">No record yet: the first one is written within five minutes of the fund&rsquo;s launch.</p>}</div>
        </section>
        <section className="gmd-terms"><h2>About {definition.ticker}</h2><dl className="gmd-facts">
          <div><dt>Method</dt><dd>Fixed token units per share, equal weight at each fixing, re-fixed each quarter at the prevailing NAV</dd></div>
          <div><dt>Prices</dt><dd>OKX OnchainOS, xStocks on X Layer mainnet</dd></div>
          <div><dt>Records</dt><dd>Every five minutes, in the NAV registry on X Layer Testnet under its own product key</dd></div>
          <div><dt>Investors</dt><dd>{fund ? `${fund.demo.investors} demo ${fund.demo.investors === 1 ? "balance" : "balances"}` : "—"}</dd></div>
          <div><dt>How to invest</dt><dd>With a demo balance. Only USTX also has a share token for wallets, pools and lending</dd></div>
        </dl><p className="gmd-caption">A demo fund on X Layer Testnet. Demo dollars and fund shares have no value, and nothing here is an offer or investment advice.</p></section>
      </div>
      {fund && <FundOrder fund={fund} nav={nav} account={account} onFilled={() => { void reload(); readJson<{ fund: FundDetail }>(`/api/v1/funds?id=${encodeURIComponent(id)}`).then(body => setFund(body.fund)).catch(() => undefined); }} />}
    </div>
  </>;
}

/** The other funds held with this browser's demo balance, on Portfolio. */
export function FundHoldings() {
  const { account } = useFundAccount();
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  useEffect(() => { readJson<{ funds: FundSummary[] }>("/api/v1/funds").then(body => setFunds(body.funds)).catch(() => undefined); }, []);
  const rows = (account?.positions ?? []).map(position => {
    const fund = funds?.find(item => item.id === position.fundId);
    const value = fund?.nav ? BigInt(position.sharesMicros) * BigInt(fund.nav.perShareMicros) / 1_000_000n : null;
    return { position, fund, value };
  });
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0n), 0n);
  return <section className="gmd-proof-history gmd-fund-portfolio" aria-labelledby="fund-portfolio-title"><header className="gmd-section-heading"><div><h2 id="fund-portfolio-title">Other funds</h2><p>Held with your demo balance, valued at each fund&rsquo;s latest NAV on X Layer.</p></div><span className="gmd-count">{formatUsdMicros(total, 2)}</span></header>
    <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Fund</th><th>Shares</th><th>Value</th><th>Return</th></tr></thead><tbody>
      {rows.map(({ position, fund, value }) => { const cost = BigInt(position.costMicros); const change = value !== null && cost > 0n ? Number((value - cost) * 10_000n / cost) / 100 : null; return <tr key={position.fundId}><th scope="row"><Link prefetch={false} href={fund?.href ?? `/funds/${position.fundId}`}>{fund?.name ?? position.fundId}</Link></th><td>{formatShares(position.sharesMicros)} {fund?.ticker}</td><td>{value === null ? "—" : formatUsdMicros(value, 2)}</td><td className={tone(change)}>{percent(change)}</td></tr>; })}
    </tbody></table></div>
  </section>;
}
