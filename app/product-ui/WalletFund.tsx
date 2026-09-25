"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsdMicros, formatUsdRounded } from "@/lib/nav-display";
import { shortTime } from "@/lib/product-market";
import { DEMO_ORDER_EVENT, formatShares } from "@/lib/demo/format";
import { FUND_DEPLOYMENT, dollarsFor, fundErrorMessage, fundExplorer, readFundAccount, type FundAccount } from "@/lib/xstocks/fund";
import { formatWadPercent, lendingPosition, readLending, type LendingAccount, type LendingMarket } from "@/lib/xstocks/lending";
import { Icon, Skeleton } from "./Icons";
import { BasketTable, useRecordComposition } from "./Basket";
import { LoanHealth } from "./Lending";

/**
 * USTX held by an address on X Layer Testnet, read from the fund contract, with any USTX it has
 * posted as collateral in the lending market and the loan against it. Read-only.
 */
export function WalletFundPosition({ address }: { address: string }) {
  const { composition } = useRecordComposition();
  const [snapshot, setSnapshot] = useState<{ owner: string; account: FundAccount; lending: { market: LendingMarket; account: LendingAccount | null } | null } | null>(null);
  const [failure, setFailure] = useState<{ owner: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const owner = address;
    // The lending read is extra: without it the wallet's own USTX still shows.
    const load = () => Promise.all([readFundAccount(owner), readLending(owner).catch(() => null)])
      .then(([account, lending]) => { if (!cancelled) { setSnapshot({ owner, account, lending }); setFailure(null); } })
      .catch(error => { if (!cancelled) setFailure({ owner, message: fundErrorMessage(error) }); });
    void load();
    window.addEventListener(DEMO_ORDER_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(DEMO_ORDER_EVENT, load); };
  }, [address, attempt]);

  const account = snapshot?.owner === address ? snapshot.account : null;
  const lending = snapshot?.owner === address ? snapshot.lending : null;
  const error = failure?.owner === address ? failure.message : null;
  const nav = account?.nav.navMicros ?? null;
  const shares = account?.sharesMicros ?? 0n;
  const value = nav !== null ? dollarsFor(shares, nav) : null;
  const loan = lending?.account ?? null;
  const collateral = loan?.collateralMicros ?? 0n;
  const debt = loan?.debtMicros ?? 0n;
  const position = loan && lending && nav !== null ? lendingPosition(collateral, debt, nav, lending.market.cashMicros) : null;
  // Collateral is still this wallet's USTX: it comes back when the loan is repaid.
  const owned = shares + collateral;

  return <section className="gmd-wallet-holdings" aria-labelledby="wallet-ustx-title" aria-live="polite">
    <header className="gmd-section-heading"><h2 id="wallet-ustx-title">USTX in this wallet</h2><span>{account ? `Block ${account.block.toLocaleString("en-US")} · X Layer Testnet` : error ? "Not read" : "Reading…"}</span></header>
    {error ? <div className="gmd-data-notice" role="status"><Icon name="info" /><span>{error}</span><button onClick={() => setAttempt(count => count + 1)}>Try again</button></div>
      : !account ? <div className="gmd-position-table is-loading" role="status"><span className="gmd-sr-only">Reading USTX and demo dollars on X Layer Testnet…</span><div className="gmd-position-row" aria-hidden="true"><div className="gmd-position-name"><Skeleton className="is-symbol" /><div><Skeleton width={120} /><Skeleton width={90} /></div></div>{[0, 1, 2].map(item => <div key={item}><Skeleton width={80} /><Skeleton width={60} /></div>)}</div></div>
      : <>
        <div className="gmd-position-table">
          <div className="gmd-position-row is-head"><span>Basket</span><span>Shares</span><span>Value</span><span>Demo dollars</span><span>Actions</span></div>
          {owned === 0n ? <p className="gmd-empty-note">This wallet holds no USTX yet{account.dollarsMicros > 0n ? `, and has ${formatUsdMicros(account.dollarsMicros, 2)} in demo dollars to invest` : ""}.</p> : shares > 0n && <div className="gmd-position-row">
            <div className="gmd-position-name"><span className="gmd-mini-monogram">G</span><div><b>US Tech Basket</b><small>USTX · in your wallet</small></div></div>
            <div><span className="gmd-mobile-label">Shares</span><b>{formatShares(shares)}</b><small>{nav !== null ? `${formatUsdMicros(nav, 4)} / share` : ""}</small></div>
            <div><span className="gmd-mobile-label">Value</span><b>{value === null ? "—" : formatUsdRounded(value)}</b><small>{account.nav.navMicros !== null ? `NAV of ${shortTime(account.nav.effectiveAt)}` : account.nav.reason}</small></div>
            <div><span className="gmd-mobile-label">Demo dollars</span><b>{formatUsdMicros(account.dollarsMicros, 2)}</b><small>dUSD, no value</small></div>
            <div className="gmd-position-actions"><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Buy</Link><Link className="gmd-small-button" prefetch={false} href="/products/ustx#investment">Sell</Link></div>
          </div>}
          {collateral > 0n && <div className="gmd-position-row">
            <div className="gmd-position-name"><span className="gmd-mini-monogram">G</span><div><b>US Tech Basket</b><small>USTX · collateral in the lending market</small></div></div>
            <div><span className="gmd-mobile-label">Shares</span><b>{formatShares(collateral)}</b><small>{nav !== null ? `${formatUsdMicros(nav, 4)} / share` : ""}</small></div>
            <div><span className="gmd-mobile-label">Value</span><b>{position ? formatUsdRounded(position.valueMicros) : "—"}</b><small>{position ? `Borrow limit ${formatUsdMicros(position.borrowLimitMicros, 2)}` : ""}</small></div>
            <div><span className="gmd-mobile-label">Loan</span><b>{formatUsdMicros(debt, 2)}</b><small>{debt > 0n && position ? `borrowed · ${formatWadPercent(position.loanToValueWad)} of its value, liquidated above 65%` : "No loan"}</small>{debt > 0n && position && <LoanHealth loanToValueWad={position.loanToValueWad} compact />}</div>
            <div className="gmd-position-actions"><Link className="gmd-small-button" prefetch={false} href="/products/ustx#borrow">Manage</Link></div>
          </div>}
        </div>
        {loan && loan.suppliedMicros > 0n && lending && <p className="gmd-caption">This wallet also lends {formatUsdMicros(loan.suppliedMicros, 2)} of demo dollars in the lending market, earning {formatWadPercent(lending.market.supplyRateWad)} a year. <Link prefetch={false} href="/products/ustx#borrow">Manage lending</Link></p>}
        {owned > 0n && composition && <div className="gmd-inside-table">
          <BasketTable composition={composition} sharesMicros={owned} label={collateral > 0n ? "The USTX in this wallet and posted as collateral, looked through to each xStock" : "The USTX in this wallet, looked through to each xStock"} chart />
        </div>}
        <p className="gmd-caption">{owned === 0n ? <>Invest from your wallet on the <Link prefetch={false} href="/products/ustx#investment">USTX page</Link>. </> : null}Every order is a transaction on X Layer Testnet. <a href={fundExplorer.address(address)} target="_blank" rel="noreferrer">See this wallet’s transactions on the OKX explorer<span className="gmd-sr-only"> (opens in a new tab)</span></a>, or the <a href={fundExplorer.token(FUND_DEPLOYMENT.fund)} target="_blank" rel="noreferrer">USTX token<span className="gmd-sr-only"> (opens in a new tab)</span></a>.</p>
      </>}
  </section>;
}
