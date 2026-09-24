"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import WalletConnect from "./WalletConnect";
import { BrandMark } from "./DesignElements";

type LocalView = "overview" | "select" | "portfolio";
type Section = LocalView | "proof";
const items: Array<{ id: Section; href: string; label: string }> = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "select", href: "/?app=select", label: "Basket" },
  { id: "proof", href: "/proof", label: "Verify NAV" },
  { id: "portfolio", href: "/?app=portfolio", label: "Paper lab" },
];

export default function SiteHeader({ current, onNavigate }: {
  current: Section | null;
  onNavigate?: (view: LocalView) => void;
}) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>, view: Section) => {
    if (!onNavigate || view === "proof" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(view);
  };

  return <header className="site-header">
    <Link className="site-identity" href="/" prefetch={false} aria-label="Ganymede Index overview" onClick={(event) => navigate(event, "overview")}><BrandMark /><strong>Ganymede</strong></Link>
    <nav className="site-navigation" aria-label="Primary navigation">
      {items.map((item) => <Link key={item.id} href={item.href} prefetch={false} aria-current={current === item.id ? "page" : undefined} onClick={(event) => navigate(event, item.id)}>{item.label}</Link>)}
    </nav>
    <div className="site-utilities"><WalletConnect compact /></div>
  </header>;
}
