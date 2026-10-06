"use client";

import { WalletInvest } from "./WalletInvest";

/**
 * The USTX order panel. Orders go from the visitor's own wallet and are recorded on X Layer Testnet,
 * paid in the demo dollars (dUSD) the wallet claims there; nothing is held for a visitor anywhere else.
 */
export function InvestPanel() {
  return <aside className="gmd-order-panel" aria-labelledby="invest-title"><WalletInvest /></aside>;
}
