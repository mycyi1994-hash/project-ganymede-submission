import Link from "next/link";

export type DocumentPage = "methodology" | "limitations" | "issuers" | "developers";

/** The side menu shared by the product and ecosystem documents. */
export function DocumentMenu({ current }: { current: DocumentPage }) {
  const link = (page: DocumentPage, href: string, label: string) => <Link prefetch={false} href={href} aria-current={current === page ? "page" : undefined}>{label}</Link>;
  return <aside className="gmd-document-menu">
    <span>Product information</span>
    <nav aria-label="Product documents">{link("methodology", "/methodology", "Methodology")}{link("limitations", "/limitations", "Risks & data policy")}<Link prefetch={false} href="/products/ustx/transparency">Transparency</Link></nav>
    <span className="gmd-document-menu-group">For partners</span>
    <nav aria-label="Partner documents">{link("issuers", "/issuers", "For issuers")}{link("developers", "/developers", "Docs & API")}</nav>
  </aside>;
}
