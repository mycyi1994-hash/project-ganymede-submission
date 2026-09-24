"use client";

import { ProductHeader } from "./product-ui/ProductShell";
import { WalletAccountProvider } from "./product-ui/WalletAccount";

type LocalView = "overview" | "select" | "portfolio";
type Section = LocalView | "proof";
export default function SiteHeader({ current }: {
  current: Section | null;
  onNavigate?: (view: LocalView) => void;
}) {
  return <WalletAccountProvider><div className="gmd-app gmd-chrome-only"><ProductHeader section={current === "portfolio" || current === null ? null : "markets"} /></div></WalletAccountProvider>;
}
