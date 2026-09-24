/* Full document links reset the query-driven home view, including navigation from its own footer. */
/* eslint-disable @next/next/no-html-link-for-pages */
import type { CSSProperties } from "react";

export function BrandMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M31 10.4A14 14 0 1 0 34 23H20l6-6h14v4A20 20 0 1 1 34.8 6.5Z" fill="currentColor" /></svg>;
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg className="ui-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h16m-6-6 6 6-6 6" />}</svg>;
}

export function StockMark({ symbol }: { symbol: string }) {
  const brand = ({ AAPLx: "apple", MSFTx: "microsoft", NVDAx: "nvidia", AMZNx: "amazon", METAx: "meta", TSLAx: "tesla" } as Record<string, string>)[symbol];
  if (brand === "microsoft") return <span className="stock-mark microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
  return <span className={`stock-mark stock-${brand ?? "generic"}`} aria-hidden="true">{brand ? <img src={`/brands/${brand}.svg`} width="34" height="34" alt="" /> : symbol.slice(0, 1)}</span>;
}

export function StrategyGlyph({ variant = "core", compact = false }: { variant?: string; compact?: boolean }) {
  return <div className={`strategy-glyph glyph-${variant}${compact ? " is-compact" : ""}`} aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ "--layer": i } as CSSProperties} />)}</div>;
}

export function SiteFooter() {
  return <footer className="site-footer"><a href="/" className="footer-brand"><BrandMark /><strong>Ganymede</strong></a><p>Testnet models. Open to inspection. No public offering.</p><a href="/proof">Proof of NAV <Arrow diagonal /></a><a href="/?app=operations">System status</a></footer>;
}
