"use client";

import { useEffect, useMemo, useState } from "react";
import { DemoPortfolio } from "./DemoInvest";
import { parseComposition } from "@/lib/xstocks/proof";
import { readBalances, tokenExplorerUrl, type WalletBalances } from "@/lib/xstocks/mainnet";
import { buildStatement, formatUnits, parseUsd, planBasket, valueWallet } from "@/lib/xstocks/wallet";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { useMarket } from "./MarketProvider";
import { useWalletAccount } from "./WalletAccount";
import { useRecordCheck } from "./useRecordCheck";
import { RecordCheckStatus } from "./ProductScreens";
import { Icon } from "./Icons";

const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;

function AddressBar() {
  const { address, source, busy, message, connect, watch, clearWatch } = useWalletAccount();
  const [input, setInput] = useState("");
  if (address) return <section className="gmd-wallet-bar" aria-label="Address"><div className="gmd-wallet-address"><span>{source === "watch" ? "Viewing a public address" : "Connected wallet"}</span><code>{address}</code></div><button type="button" className="gmd-small-button" onClick={() => { clearWatch(); setInput(""); }}>Use another address</button><p className="gmd-caption">Read-only. Balances come straight from X Layer mainnet; nothing is signed or sent.</p></section>;
  return <section className="gmd-wallet-bar" aria-label="Address"><button type="button" className="gmd-button" disabled={busy} onClick={() => void connect()}><Icon name="wallet" size={17} />{busy ? "Connecting…" : "Connect wallet"}</button><form className="gmd-wallet-form" onSubmit={event => { event.preventDefault(); watch(input); }}><label htmlFor="portfolio-address">Or view any public address</label><div><input id="portfolio-address" value={input} onChange={event => setInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /><button type="submit" className="gmd-small-button">View</button></div></form><p role="status" className="gmd-wallet-message">{message}</p><p className="gmd-caption">Read-only. Your wallet only shares a public address; nothing is signed or sent.</p></section>;
}

export default function WalletPortfolio() {
  const { data, error } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const { address } = useWalletAccount();
  const [balances, setBalances] = useState<{ owner: string; value: WalletBalances } | null>(null);
  const [readError, setReadError] = useState<{ owner: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [amount, setAmount] = useState("1,000");

  const verifiedCanonical = state === "matched" ? checks?.canonical ?? null : null;
  const composition = useMemo(() => {
    if (!verifiedCanonical) return null;
    try { return parseComposition(verifiedCanonical); } catch { return null; }
  }, [verifiedCanonical]);
  const record = checks?.record?.effectiveAt ? checks.record : null;
  const transactionHash = record ? [data?.latest?.publication, ...(data?.history ?? [])].find(entry => entry?.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase())?.txHash ?? null : null;

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void readBalances(address).then(value => { if (!cancelled) { setBalances({ owner: address, value }); setReadError(null); } }).catch(reason => { if (!cancelled) setReadError({ owner: address, message: reason instanceof Error ? reason.message : "Balances could not be read." }); });
    return () => { cancelled = true; };
  }, [address, attempt]);

  const current = balances?.owner === address ? balances.value : null;
  const failure = readError?.owner === address ? readError.message : null;
  const valuation = useMemo(() => {
    if (!current || !composition) return null;
    try { return valueWallet(current, composition); } catch { return null; }
  }, [current, composition]);
  const amountMicros = parseUsd(amount);
  const plan = composition && amountMicros ? planBasket(amountMicros, composition) : [];

  function downloadStatement() {
    if (!current || !valuation || !record) return;
    const statement = buildStatement(current, valuation, { effectiveAt: record.effectiveAt!, holdingsHash: record.holdingsHash, transactionHash }, new Date());
    const url = URL.createObjectURL(new Blob([JSON.stringify(statement, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `xstocks-valuation-${current.owner.slice(0, 8)}-block-${current.blockNumber}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const priceNote = state === "matched" && record ? `Prices from the ${shortTime(record.effectiveAt)} record, verified in your browser` : state === "failed" || state === "unavailable" ? "The price record could not be verified, so nothing is valued." : "Waiting for the price record to be verified in this browser…";

  return <>
    <div className="gmd-page-heading"><div><h1>Portfolio</h1><p>Your demo USTX investments and your xStocks on X Layer, valued with prices you can verify.</p></div><RecordCheckStatus /></div>
    <DemoPortfolio />
    <header className="gmd-section-heading gmd-wallet-heading"><div><h2>Your xStocks on X Layer</h2><p>Connect a wallet or view any public address. Read-only.</p></div></header>
    <AddressBar />
    {address && <section className="gmd-wallet-holdings" aria-labelledby="holdings-title" aria-live="polite"><header className="gmd-section-heading"><h2 id="holdings-title">xStock holdings</h2><span>{current ? `Block ${current.blockNumber.toLocaleString("en-US")} · ${shortTime(current.blockTime)} · X Layer mainnet` : failure ? "Not read" : "Reading balances…"}</span></header>
      {failure ? <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{failure}</span><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div>
        : !current ? <p className="gmd-caption">Reading the six xStock balances at the latest block…</p>
        : !valuation ? <p className="gmd-caption">{priceNote}</p>
        : <><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th><th>Weight</th><th>USTX weight</th></tr></thead><tbody>{valuation.rows.map(row => <tr key={row.symbol}><th scope="row"><a href={tokenExplorerUrl(row.address)} target="_blank" rel="noreferrer">{row.symbol} <Icon name="external" size={12} /></a></th><td>{formatUnits(row.units)}</td><td>{formatUsdMicros(row.priceMicros, 2)}</td><td>{formatUsdMicros(row.valueMicros, 2)}</td><td>{BigInt(valuation.totalMicros) === 0n ? "—" : percent(row.weightBps)}</td><td>{percent(row.modelWeightBps)}</td></tr>)}</tbody></table></div>
          <div className="gmd-wallet-summary"><div><span>Value of the six xStocks</span><strong>{formatUsdMicros(valuation.totalMicros, 2)}</strong><small>{priceNote}</small></div><button type="button" className="gmd-small-button" onClick={downloadStatement}><Icon name="download" size={16} />Download statement</button></div>
          {BigInt(valuation.totalMicros) === 0n && <p className="gmd-caption">{valuation.rows.some(row => row.units !== "0") ? "This address holds only amounts too small to value to the cent." : "This address holds none of the six xStocks on X Layer."}</p>}</>}
    </section>}
    <section className="gmd-plan" aria-labelledby="plan-title"><div className="gmd-plan-intro"><h2 id="plan-title">Size a USTX-weighted basket</h2><p>Enter an amount to see how many of each token the basket’s current weights imply at the recorded prices.</p></div>
      <div className="gmd-plan-input"><label htmlFor="plan-amount">Amount in USD</label><input id="plan-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={amountMicros === null} aria-describedby="plan-help" /><p id="plan-help">{amountMicros === null ? "Enter an amount such as 1,000 or 250.50." : composition ? "Uses the prices and weights of the verified record." : priceNote}</p></div>
      {plan.length > 0 && <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Asset</th><th>Weight</th><th>Price</th><th>Amount</th><th>Tokens</th></tr></thead><tbody>{plan.map(row => <tr key={row.symbol}><th scope="row"><a href={tokenExplorerUrl(row.address)} target="_blank" rel="noreferrer">{row.symbol} <Icon name="external" size={12} /></a></th><td>{percent(row.modelWeightBps)}</td><td>{formatUsdMicros(row.priceMicros, 2)}</td><td>{formatUsdMicros(row.usdMicros, 2)}</td><td>{formatUnits(row.units)}</td></tr>)}</tbody></table></div>}
      <p className="gmd-caption">An illustration at recorded prices, not an order or a quote. Trading costs and slippage are not included, and xStocks are not available in every country. Token links open the OKX X Layer explorer.</p>
    </section>
  </>;
}
