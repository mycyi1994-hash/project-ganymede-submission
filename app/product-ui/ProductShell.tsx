"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "../DesignElements";
import { Icon } from "./Icons";
import { MarketProvider } from "./MarketProvider";
import { WalletAccountProvider, useWalletAccount } from "./WalletAccount";
import "./product.css";

export type ProductSection = "markets" | "verify" | "portfolio" | "activity";
export type DesignScreen = "markets" | "product" | "order" | "portfolio" | "holding" | "activity" | "transaction";
export function designLink(screen: DesignScreen, scenario?: string) { return `/design-preview?screen=${screen}${scenario ? `&scenario=${scenario}` : ""}`; }

function AccountControl() {
  const router = useRouter();
  const { address, source, busy, message, connect, watch, clearWatch } = useWalletAccount();
  const [input, setInput] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (details.current && !details.current.contains(event.target as Node)) details.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <details ref={details} className="gmd-account" onKeyDown={event => { if (event.key === "Escape" && details.current?.open) { details.current.open = false; details.current.querySelector("summary")?.focus(); } }}>
    <summary><Icon name="wallet" size={17} /><span>{address ? address.slice(0, 6) + "…" + address.slice(-4) : "Connect wallet"}</span></summary>
    <div className="gmd-account-popover"><strong>{address ? source === "watch" ? "Viewing a public address" : "Connected wallet" : "Your wallet"}</strong>
      <p>{address || "Connect to read your testnet share records. No signature or transaction is requested."}</p>
      {(!address || source === "watch") && <button className="gmd-button" disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect browser wallet"}</button>}
      <form className="gmd-watch-form" onSubmit={event => { event.preventDefault(); if (watch(input)) { if (details.current) details.current.open = false; router.push("/portfolio"); } }}><label htmlFor="public-ledger-address">View a public address</label><input id="public-ledger-address" value={input} onChange={event => setInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /><button className="gmd-small-button" type="submit">View records</button></form>
      {source === "watch" && address && <button className="gmd-inline-link" onClick={() => { clearWatch(); setInput(""); if (details.current) details.current.open = false; }}>Stop viewing address</button>}
      <p role="status">{message}</p><p className="gmd-caption">Read-only public records on X Layer Testnet. No deposits or withdrawals.</p>
    </div>
  </details>;
}

export function ProductHeader({ section = "markets", preview }: { section?: ProductSection | null; preview?: DesignScreen }) {
  const links = [{ section: "markets", label: "Markets", href: "/", icon: "market" }, { section: "portfolio", label: "Portfolio", href: "/portfolio", icon: "portfolio" }, { section: "verify", label: "Verify", href: "/products/ustx/transparency", icon: "check" }] as const;
  // The header address control only serves the separate test share ledger page.
  const ledger = section === "activity";
  return <header className="gmd-header"><div className="gmd-header-inner"><Link href={preview ? designLink("markets") : "/"} prefetch={false} className="gmd-brand" aria-label="Ganymede markets"><BrandMark /><span>Ganymede</span></Link><nav className="gmd-navigation" aria-label="Primary navigation">{links.map(link => <Link prefetch={false} key={link.section} href={preview && link.section !== "verify" ? designLink(link.section) : link.href} aria-current={section === link.section ? "page" : undefined}><Icon name={link.icon} size={18} /><span>{link.label}</span></Link>)}</nav><div className="gmd-header-end">{preview ? <span className="gmd-example-account"><Icon name="wallet" size={17} />Example account</span> : ledger ? <><span className="gmd-environment"><i />Testnet ledger</span><AccountControl /></> : null}</div></div></header>;
}

export function ProductShell({ children, section = "markets", preview }: { children: ReactNode; section?: ProductSection; preview?: DesignScreen }) {
  return <WalletAccountProvider><MarketProvider enabled={section === "markets" || section === "verify" || section === "portfolio"}><div className="gmd-app">
    <a className="gmd-skip" href="#product-main">Skip to content</a>
    {preview && <div className="gmd-design-toolbar"><span><b>Design preview</b> Example account data. No transactions.</span><nav aria-label="Design screens">{(["markets", "product", "order", "portfolio", "transaction"] as const).map(screen => <Link prefetch={false} key={screen} href={designLink(screen)} aria-current={preview === screen ? "page" : undefined}>{({ markets: "Markets", product: "Product", order: "Order", portfolio: "Portfolio", transaction: "Transaction" })[screen]}</Link>)}</nav></div>}
    <ProductHeader section={section} preview={preview} />
    <main id="product-main" className="gmd-main">{children}</main>
    <footer className="gmd-footer"><div><b>Ganymede</b><span>Market data by OKX OnchainOS · Built on X Layer · Demo dollars only · Not investment advice</span></div><nav aria-label="Resources"><Link prefetch={false} href="/products/ustx/transparency">Verify</Link><Link prefetch={false} href="/methodology">Methodology</Link><Link prefetch={false} href="/limitations">Limitations</Link><Link prefetch={false} href="/issuers">For issuers</Link><Link prefetch={false} href="/developers">Developers</Link></nav></footer>
  </div></MarketProvider></WalletAccountProvider>;
}
