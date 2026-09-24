import Link from "next/link";
import SiteHeader from "./SiteHeader";
import { Arrow, SiteFooter, StrategyGlyph } from "./DesignElements";

export default function NotFound() {
  return <><SiteHeader current={null} /><main className="not-found-page"><StrategyGlyph /><span className="eyebrow">Page not found</span><h1>A different path<br />to your next strategy.</h1><p>This page doesn’t exist. Explore the collection or return to the overview.</p><div className="button-row"><Link className="button is-primary" href="/?app=select">Explore funds <Arrow /></Link><Link className="button" href="/">Back to overview</Link></div></main><SiteFooter /></>;
}
