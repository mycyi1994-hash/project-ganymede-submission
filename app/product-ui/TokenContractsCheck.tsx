"use client";

import { useEffect, useState } from "react";
import { readTokenFacts, XSTOCK_TOKENS, type TokenFact } from "@/lib/xstocks/mainnet";
import { parseComposition } from "@/lib/xstocks/proof";

/** Confirms the document's token addresses are the pinned xStock contracts, read from X Layer mainnet. */
export default function TokenContractsCheck({ canonical }: { canonical: string | null }) {
  const [facts, setFacts] = useState<TokenFact[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readTokenFacts().then(value => { if (!cancelled) setFacts(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  let documentMatches: boolean | null = null;
  if (canonical) {
    try {
      const holdings = parseComposition(canonical).holdings;
      documentMatches = holdings.length > 0 && holdings.every(holding => XSTOCK_TOKENS.some(token => holding.symbol === token.symbol && holding.address.toLowerCase() === token.address));
    } catch { documentMatches = false; }
  }
  const held = canonical ? (() => { try { return parseComposition(canonical).holdings.map(holding => holding.symbol); } catch { return []; } })() : [];
  const matching = facts?.filter(fact => fact.matches && held.includes(fact.symbol)).length ?? 0;
  const label = failed ? "Not read" : !facts || documentMatches === null ? "Checking…" : documentMatches && matching === held.length ? `${matching} of ${held.length} match` : "Mismatch";
  const detail = failed ? "X Layer mainnet could not be read from this browser." : documentMatches === false ? "The document's token addresses differ from the pinned xStock contracts." : "Each address in the document is a pinned xStock contract. Its code, symbol and 18 decimals are read from X Layer mainnet.";
  return <div className="gmd-record-condition" aria-live="polite"><span>xStock contracts</span><b>{label}</b><p>{detail}</p></div>;
}
