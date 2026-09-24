"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LEDGER, formatShares, readLedger, readLedgerReceipt, transferLabel, type LedgerSnapshot, type LedgerReceipt, type LedgerTransfer } from "@/lib/product-ledger";
import { shortTime } from "@/lib/product-market";
import { useWalletAccount } from "./WalletAccount";
import { Icon } from "./Icons";

function useLedgerSnapshot() {
  const { address } = useWalletAccount();
  const [result, setResult] = useState<LedgerSnapshot | null>(null);
  const [request, setRequest] = useState<{ account: string; busy: boolean; error: string }>({ account: "", busy: false, error: "" });
  const active = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (!address) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setRequest({ account: address, busy: true, error: "" });
    try {
      const next = await readLedger(address, { signal: controller.signal });
      if (!controller.signal.aborted) { setResult(next); setRequest({ account: address, busy: false, error: "" }); }
    } catch (error) {
      if (!controller.signal.aborted) setRequest({ account: address, busy: false, error: error instanceof Error ? error.message : "The ledger could not be loaded." });
    }
  }, [address]);
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const interval = setInterval(() => { if (!document.hidden) void reload(); }, 60_000);
    return () => { clearTimeout(first); clearInterval(interval); active.current?.abort(); };
  }, [reload]);
  return { data: result?.account === address ? result : null, busy: Boolean(address) && (request.account !== address || request.busy), error: request.account === address ? request.error : "", reload };
}

function ConnectLedger() {
  const { busy, message, connect, watch } = useWalletAccount();
  const [value, setValue] = useState("");
  return <section className="gmd-account-empty"><div className="gmd-empty-symbol"><Icon name="wallet" size={30} /></div><h2>Your testnet share records.</h2><p>Connect a wallet or enter a public address to read the deployed Ganymede Core 20 share ledger.</p><button className="gmd-button" disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect wallet"}</button><form className="gmd-public-address" onSubmit={event => { event.preventDefault(); watch(value); }}><label htmlFor="ledger-address">Or view a public address</label><div><input id="ledger-address" value={value} onChange={event => setValue(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} /><button className="gmd-small-button">View records</button></div></form><p className="gmd-caption" role="status">{message || "Read-only. No network switch, signature or transaction."}</p></section>;
}

function LedgerScope() {
  return <div className="gmd-ledger-scope"><Icon name="info" size={19} /><p><b>Testnet share ledger.</b> GMDCORE records are separate from the USTX model basket. They do not represent custody, redeemable assets or a cash balance.</p></div>;
}
function LedgerResources() {
  return <div className="gmd-lab-reference"><div><b>Saved paper allocations</b><p>Your crypto strategy simulations are kept in Lab.</p></div><Link href="/lab">Open Lab <Icon name="arrow" size={16} /></Link></div>;
}
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function TransferRows({ rows, account }: { rows: LedgerTransfer[]; account?: string }) {
  return <div className="gmd-ledger-transfers">{rows.map(row => <Link href={`/activity/${row.hash}`} prefetch={false} key={`${row.hash}:${row.index}`}><span className="gmd-transaction-symbol"><Icon name="activity" /></span><span><b>{transferLabel(row, account)}</b><small>Block {row.block.toLocaleString("en-US")} · {shortAddress(row.hash)}</small></span><span><b>{formatShares(row.units)}</b><small>GMDCORE · Testnet</small></span><Icon name="chevron" size={16} /></Link>)}</div>;
}

export function LedgerScreen({ activity = false }: { activity?: boolean }) {
  const wallet = useWalletAccount();
  const { data, error, busy, reload } = useLedgerSnapshot();
  return <><div className="gmd-page-heading"><div><h1>{activity ? "Activity" : "Portfolio"}</h1><p>{activity ? "Transfers recorded by the testnet share ledger." : "Your recorded testnet shares, in one place."}</p></div>{wallet.address && <button className="gmd-small-button" disabled={busy} onClick={() => void reload()}><Icon name="refresh" size={16} />{busy ? "Refreshing…" : "Refresh records"}</button>}</div><LedgerScope />
    {!wallet.address ? <ConnectLedger /> : <><div className="gmd-ledger-account"><span>{wallet.source === "watch" ? "Viewing public address" : "Connected wallet"}</span><code>{wallet.address}</code><span>X Layer Testnet</span></div>
      {error && <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error}{data ? " Showing the last loaded record." : " No balance has been confirmed."}</span><button onClick={() => void reload()} disabled={busy}>Try again</button></div>}
      {!activity && <section className="gmd-ledger-overview" aria-busy={busy}><div><span className="gmd-label">Recorded shares / GMDCORE</span><strong className="gmd-value">{data ? formatShares(data.balance) : "—"}</strong><p>{data ? `As of ${shortTime(data.blockTime)}` : busy ? "Reading your address from the public ledger…" : "A recorded balance is unavailable."}</p></div><div><span className="gmd-label">Ganymede Core 20</span><p>Issuer-controlled testnet share records. These shares have no displayed investment value.</p><a className="gmd-inline-link" href={`${LEDGER.explorerUrl}/address/${LEDGER.address}`} target="_blank" rel="noreferrer">View share contract <Icon name="external" size={14} /></a></div></section>}
      <section className="gmd-ledger-history"><header className="gmd-section-heading"><div><h2>{activity ? "Recorded transfers" : "Recent activity"}</h2><p>{data ? `Blocks ${data.fromBlock.toLocaleString("en-US")}–${data.block.toLocaleString("en-US")}. This is a limited history window.` : "The latest 2,000 blocks are searched for this address."}</p></div>{!activity && data && <Link href="/activity">View all <Icon name="arrow" size={16} /></Link>}</header>
        {data?.transfers.length ? <TransferRows rows={activity ? data.transfers : data.transfers.slice(0, 4)} account={wallet.address} /> : <div className="gmd-ledger-empty"><Icon name="activity" size={24} /><p>{data ? "No share transfers found in this block range." : busy ? "Reading ledger history…" : "Ledger history is unavailable."}</p>{data && <a className="gmd-inline-link" href={`${LEDGER.explorerUrl}/address/${wallet.address}`} target="_blank" rel="noreferrer">Browse older activity in explorer <Icon name="external" size={14} /></a>}</div>}
      </section></>}
    <div className="gmd-ledger-ustx"><div><b>Looking for US Tech Basket holdings?</b><p>USTX investments and withdrawals are not open. Its published NAV describes a model basket.</p></div><Link href="/products/ustx">Explore USTX <Icon name="arrow" size={16} /></Link></div><LedgerResources />
  </>;
}

export function LedgerTransaction({ hash }: { hash: string }) {
  const [record, setRecord] = useState<LedgerReceipt | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const start = setTimeout(() => {
      setBusy(true); setError("");
      void readLedgerReceipt(hash, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setRecord(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The transaction could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 0);
    return () => { clearTimeout(start); controller.abort(); };
  }, [hash, attempt]);
  const data = record?.hash === hash.toLowerCase() ? record : null;
  return <><Link href="/activity" className="gmd-breadcrumb"><Icon name="back" size={16} />All activity</Link><div className="gmd-page-heading"><div><h1>Share transaction</h1><p>Ganymede Core 20 · X Layer Testnet</p></div><button className="gmd-small-button" disabled={busy} onClick={() => setAttempt(value => value + 1)}><Icon name="refresh" size={16} />{busy ? "Reading…" : "Refresh receipt"}</button></div><LedgerScope />
    {error && <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error}{data ? " Showing the previously read receipt." : ""}</span></div>}
    <section className="gmd-ledger-receipt"><header><span className={`gmd-status ${data && !error ? "is-positive" : "is-waiting"}`}><i />{data && !error ? "Included on chain" : busy ? "Reading the receipt" : "Receipt unavailable"}</span><h2>{data ? `${data.transfers.length} share transfer${data.transfers.length === 1 ? "" : "s"} recorded` : "Transaction details"}</h2><p>{data ? shortTime(data.blockTime) : "No completed transfer is assumed before the receipt is read."}</p></header><dl className="gmd-facts"><div><dt>Transaction</dt><dd><code>{hash}</code></dd></div><div><dt>Share contract</dt><dd><code>{LEDGER.address}</code></dd></div><div><dt>Block</dt><dd>{data?.block.toLocaleString("en-US") ?? "—"}</dd></div></dl>
      {data?.transfers.map(row => <article className="gmd-ledger-transfer-detail" key={row.index}><h3>{transferLabel(row)}</h3><strong>{formatShares(row.units)} <small>GMDCORE</small></strong><dl className="gmd-facts"><div><dt>From</dt><dd><code>{row.from}</code></dd></div><div><dt>To</dt><dd><code>{row.to}</code></dd></div></dl></article>)}
      <a className="gmd-button is-secondary" href={`${LEDGER.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">Open transaction explorer <Icon name="external" size={16} /></a><p className="gmd-caption">A share issue or burn is a ledger entry. It does not confirm a deposit, asset purchase or payout.</p>
    </section></>;
}
