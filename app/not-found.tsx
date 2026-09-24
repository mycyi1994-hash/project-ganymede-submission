import Link from "next/link";
import { ProductShell } from "./product-ui/ProductShell";
import { Icon } from "./product-ui/Icons";

export default function NotFound() {
  return <ProductShell><section className="gmd-unavailable-page"><span className="gmd-badge">404 · Page not found</span><h1>Let’s get you back.</h1><p>This page has moved or doesn’t exist. Your market view is one step away.</p><div><Link className="gmd-button" href="/">Back to markets <Icon name="arrow" size={16} /></Link><Link className="gmd-button is-secondary" href="/products/ustx">Explore US Tech Basket</Link></div></section></ProductShell>;
}
