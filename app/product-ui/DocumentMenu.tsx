import Link from "next/link";

export type DocumentPage = "methodology" | "limitations" | "issuers" | "developers";

/** The side menu shared by the product and ecosystem documents. */
export function DocumentMenu({ current }: { current: DocumentPage }) {
  const link = (page: DocumentPage, href: string, label: string) => <Link prefetch={false} href={href} aria-current={current === page ? "page" : undefined}>{label}</Link>;
  return <aside className="gmd-document-menu">
    <span>Product information</span>
    <nav aria-label="Product documents">{link("methodology", "/methodology", "How pricing works")}{link("limitations", "/limitations", "Risks & limitations")}<Link prefetch={false} href="/products/ustx/transparency">Transparency</Link></nav>
    <span className="gmd-document-menu-group">For partners</span>
    <nav aria-label="Partner documents">{link("issuers", "/issuers", "For issuers")}{link("developers", "/developers", "Integrations")}</nav>
  </aside>;
}

const PAGE_LABELS: Record<DocumentPage, string> = { methodology: "How pricing works", limitations: "Risks & limitations", issuers: "For issuers", developers: "Integrations" };

/** A document's title bar: where the page sits, as a console's breadcrumb, with the page's own heading in the text below. */
export function DocumentBar({ current, parent }: { current: DocumentPage; parent: { href: string; label: string } }) {
  return <div className="gmd-page-heading"><nav className="gmd-crumbs" aria-label="Breadcrumb"><Link prefetch={false} href={parent.href}>{parent.label}</Link><span aria-hidden="true">/</span><span aria-current="page">{PAGE_LABELS[current]}</span></nav></div>;
}
