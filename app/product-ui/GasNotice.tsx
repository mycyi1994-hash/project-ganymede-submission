"use client";

import { useState } from "react";
import { FUND_DEPLOYMENT, fundExplorer } from "@/lib/xstocks/fund";
import { FAUCET_TERMS, formatOkb } from "@/lib/faucet-terms";
import { Icon } from "./Icons";

type Drip = { state: "sending" } | { state: "sent"; hash: string } | { state: "failed"; message: string };

/**
 * Shown while a wallet has almost no test OKB for network fees: one click sends it enough for about
 * a hundred transactions, once per wallet, and the OKX faucet stays a link away.
 */
export default function GasNotice({ address, gasWei, onFunded }: { address: string; gasWei: bigint; onFunded: () => void }) {
  const [drip, setDrip] = useState<Drip | null>(null);
  if (gasWei >= FAUCET_TERMS.lowWei && drip?.state !== "sent") return null;
  const okx = <a href={FUND_DEPLOYMENT.faucetUrl} target="_blank" rel="noreferrer">OKX faucet<span className="gmd-sr-only"> (opens in a new tab)</span></a>;
  async function ask() {
    setDrip({ state: "sending" });
    try {
      const response = await fetch("/api/faucet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
      const body = await response.json().catch(() => ({})) as { hash?: string; error?: string };
      if (!response.ok || !body.hash) throw new Error(body.error ?? "Test OKB could not be sent just now.");
      setDrip({ state: "sent", hash: body.hash });
      // X Layer Testnet confirms in a few seconds; then the balances are read again.
      setTimeout(onFunded, 6_000);
    } catch (error) {
      setDrip({ state: "failed", message: error instanceof Error ? error.message : "Test OKB could not be sent just now." });
    }
  }
  if (drip?.state === "sent") return <p className="gmd-wallet-gas is-done" role="status"><Icon name="check" size={16} /><span>{formatOkb(FAUCET_TERMS.dripWei)} is on its way for network fees. <a href={fundExplorer.tx(drip.hash)} target="_blank" rel="noreferrer">View transaction<span className="gmd-sr-only"> (opens in a new tab)</span></a></span></p>;
  return <div className="gmd-wallet-gas" role="status"><Icon name="info" size={16} /><div>
    <span>{gasWei === 0n ? "You need test OKB to pay network fees." : "Your test OKB for network fees is running low."}</span>
    <div className="gmd-wallet-gas-actions">
      <button type="button" className="gmd-small-button" disabled={drip?.state === "sending"} onClick={() => void ask()}>{drip?.state === "sending" ? "Sending test OKB…" : "Get free test OKB"}</button>
      <span>or use the {okx}</span>
    </div>
    {drip?.state === "failed" && <p className="gmd-inline-error" role="alert">{drip.message}</p>}
  </div></div>;
}
