"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { DEMO_ORDER_EVENT, formatShares } from "@/lib/demo/format";
import { FUND_DEPLOYMENT, dollarsFor, fundErrorMessage, fundExplorer, readFundAccount, type FundAccount } from "@/lib/xstocks/fund";
import { Icon } from "./Icons";
import { BasketTable, useRecordComposition } from "./Basket";

/** USTX held by an address on X Layer Testnet, read from the fund contract. Read-only. */
export function WalletFundPosition({ address }: { address: string }) {
  const { composition } = useRecordComposition();
  const [snapshot, setSnapshot] = useState<{ owner: string; account: FundAccount } | null>(null);
  const [failure, setFailure] = useState<{ owner: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const owner = address;
    const load = () => readFundAccount(owner)
      .then(account => { if (!cancelled) { setSnapshot({ owner, account }); setFailure(null); } })
      .catch(error => { if (!cancelled) setFailure({ owner, message: fundErrorMessage(error) }); });
    void load();
    window.addEventListener(DEMO_ORDER_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(DEMO_ORDER_EVENT, load); };
  }, [address, attempt]);

  const account = snapshot?.owner === address ? snapshot.account : null;
  const error = failure?.owner === address ? failure.message : null;
  const nav = account?.nav.navMicros ?? null;
  const shares = account?.sharesMicros ?? 0n;
  const value = nav !== null ? dollarsFor(shares, nav) : null;

  return <section className="gmd-wallet-holdings" aria-labelledby="wallet-ustx-title" aria-live="polite">
    <header className="gmd-section-heading"><h2 id="wallet-ustx-title">USTX in this wallet</h2><span>{account ? `Block ${account.block.toLocaleString("en-US")} · X Layer Testnet` : error ? "Not read" : "Reading…"}</span></header>
    {error ? <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error}</span><button onClick={() => setAttempt(count => count + 1)}>Try again</button></div>
      : !account ? <p className="gmd-caption">Reading USTX and demo dollars on X Layer Testnet…</p>
      : <>
        <div className="gmd-position-table">
          <div className="gmd-position-row is-head"><span>Basket</span><span>Shares</span><span>Value</span><span>Demo dollars</span><span>Actions</span></div>
          {shares === 0n ? <p className="gmd-empty-note">This wallet holds no USTX yet{account.dollarsMicros > 0n ? `, and has ${formatUsdMicros(account.dollarsMicros, 2)} in demo dollars to invest` : ""}.</p> : <div className="gmd-position-row">
            <div className="gmd-position-name"><span className="gmd-mini-monogram">G</span><div><b>US Tech Basket</b><small>USTX · in your wallet</small></div></div>
            <div><span className="gmd-mobile-label">Shares</span><b>{formatShares(shares)}</b><small>{nav !== null ? `${formatUsdMicros(nav, 4)} / share` : ""}</small></div>
            <div><span className="gmd-mobile-label">Value</span><b>{value === null ? "—" : formatUsdRounded(value)}</b><small>{account.nav.navMicros !== null ? `NAV of ${shortTime(account.nav.effectiveAt)}` : account.nav.reason}</small></div>
            <div><span className="gmd-mobile-label">Demo dollars</span><b>{formatUsdMicros(account.dollarsMicros, 2)}</b><small>dUSD, no value</small></div>
            <div className="gmd-position-actions"><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Buy</Link><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Redeem</Link></div>
          </div>}
        </div>
        {shares > 0n && composition && <div className="gmd-inside-table">
          <BasketTable composition={composition} sharesMicros={shares} label="The USTX in this wallet, looked through to each xStock" />
        </div>}
        <p className="gmd-caption">{shares === 0n ? <>Invest from your wallet on the <Link prefetch={false} href="/products/ustx#investment">USTX page</Link>. </> : null}Every order is a transaction on X Layer Testnet. <a href={fundExplorer.address(address)} target="_blank" rel="noreferrer">See this wallet’s transactions on the OKX explorer<span className="gmd-sr-only"> (opens in a new tab)</span></a>, or the <a href={fundExplorer.token(FUND_DEPLOYMENT.fund)} target="_blank" rel="noreferrer">USTX token<span className="gmd-sr-only"> (opens in a new tab)</span></a>.</p>
      </>}
  </section>;
}
