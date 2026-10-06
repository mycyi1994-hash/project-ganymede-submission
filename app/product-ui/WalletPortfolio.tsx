"use client";

import { useEffect, useMemo, useState } from "react";
import { WalletFundPosition } from "./WalletFund";
import { parseComposition } from "@/lib/xstocks/proof";
import { readBalances, tokenExplorerUrl, type WalletBalances } from "@/lib/xstocks/mainnet";
import { buildStatement, formatUnits, valueWallet } from "@/lib/xstocks/wallet";
import { formatUsdMicros } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { useMarket } from "./MarketProvider";
import { useWalletAccount } from "./WalletAccount";
import { useRecordCheck } from "./useRecordCheck";
import { Icon } from "./Icons";

const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/** Whose holdings these are: one line once an address is set (the header already shows a connected wallet), or the ways to set one. */
function AddressBar() {
  const { address, source, busy, message, connect, watch, clearWatch } = useWalletAccount();
  const [input, setInput] = useState("");
  if (address) return <p className="gmd-wallet-inline">{source === "watch" ? "Viewing" : "Your wallet"} <code title={address}>{shortAddress(address)}</code><button type="button" className="gmd-text-button" onClick={() => { clearWatch(); setInput(""); }}>{source === "watch" ? "Clear" : "View another address"}</button></p>;
  return <section className="gmd-wallet-bar" aria-label="Address"><button type="button" className="gmd-button" disabled={busy} onClick={() => void connect()}><Icon name="wallet" size={17} />{busy ? "Connecting…" : "Connect OKX Wallet"}</button><form className="gmd-wallet-form" onSubmit={event => { event.preventDefault(); watch(input); }}><label htmlFor="portfolio-address">Or view any public address</label><div><input id="portfolio-address" value={input} onChange={event => setInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /><button type="submit" className="gmd-small-button">View</button></div></form><p role="status" className="gmd-wallet-message">{message}</p><p className="gmd-caption">Connecting lets you view your holdings. It does not request a payment or signature.</p></section>;
}

export default function WalletPortfolio() {
  const { data, error } = useMarket();
  const { checks, state } = useRecordCheck(data, error);
  const { address } = useWalletAccount();
  const [balances, setBalances] = useState<{ owner: string; value: WalletBalances } | null>(null);
  const [readError, setReadError] = useState<{ owner: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

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

  const priceNote = state === "matched" && record ? `OKX OnchainOS prices from the ${shortTime(record.effectiveAt)} record, verified in your browser` : state === "failed" || state === "unavailable" ? "The price record could not be verified, so nothing is valued." : "Checking prices for your holdings…";

  return <>
    <div className="gmd-page-heading"><div><h1>Portfolio</h1><p>Your USTX and your xStocks on X Layer, valued at OKX OnchainOS prices.</p></div></div>
    <header id="wallet" className="gmd-section-heading gmd-wallet-heading"><div><h2>Your wallet on X Layer</h2><p>{address ? "Your USTX on X Layer Testnet and your xStocks on X Layer mainnet." : "View your USTX on Testnet and your xStocks on X Layer mainnet. Connect OKX Wallet or enter a public address."}</p></div></header>
    <AddressBar />
    {address && <WalletFundPosition address={address} />}
    {address && <section className="gmd-wallet-holdings" aria-labelledby="holdings-title" aria-live="polite"><header className="gmd-section-heading"><h2 id="holdings-title">xStock holdings</h2><span>{current ? `Block ${current.blockNumber.toLocaleString("en-US")} · ${shortTime(current.blockTime)} · X Layer mainnet` : failure ? "Not read" : "Reading balances…"}</span></header>
      {failure ? <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{failure}</span><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div>
        : !current ? <p className="gmd-caption">Reading the nine xStock balances at the latest block…</p>
        : !valuation ? <p className="gmd-caption">{priceNote}</p>
        : <><div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Asset</th><th>Balance</th><th>OKX price</th><th>Value</th><th>Weight</th><th>USTX weight</th></tr></thead><tbody>{valuation.rows.map(row => <tr key={row.symbol}><th scope="row"><a href={tokenExplorerUrl(row.address)} target="_blank" rel="noreferrer">{row.symbol} <Icon name="external" size={12} /></a></th><td>{formatUnits(row.units)}</td><td>{formatUsdMicros(row.priceMicros, 2)}</td><td>{formatUsdMicros(row.valueMicros, 2)}</td><td>{BigInt(valuation.totalMicros) === 0n ? "—" : percent(row.weightBps)}</td><td>{percent(row.modelWeightBps)}</td></tr>)}</tbody></table></div>
          <div className="gmd-wallet-summary"><div><span>Value of the nine xStocks</span><strong>{formatUsdMicros(valuation.totalMicros, 2)}</strong><small>{priceNote}</small></div><button type="button" className="gmd-small-button" onClick={downloadStatement}><Icon name="download" size={16} />Download statement</button></div>
          {BigInt(valuation.totalMicros) === 0n && <p className="gmd-caption">{valuation.rows.some(row => row.units !== "0") ? "This address holds only amounts too small to value to the cent." : "This address holds none of the nine xStocks in USTX."}</p>}</>}
    </section>}
  </>;
}
