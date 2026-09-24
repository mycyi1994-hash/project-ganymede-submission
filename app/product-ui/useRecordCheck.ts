"use client";

import { useEffect, useState } from "react";
import { PROOF_DEPLOYMENT, verifyComposition, type Check } from "@/lib/xstocks/proof";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";
import type { MarketSnapshot } from "@/lib/product-market";

export type RecordCheck = { source: MarketSnapshot; chain: Check; hash: Check; nav: Check; record: OnchainNav | null; canonical: string | null; error: string | null };
export type RecordCheckState = "unavailable" | "failed" | "matched" | "waiting" | "loading";

/**
 * Reads the pinned registry directly from this browser and checks the matching published
 * document against it. The server snapshot only supplies the candidate document.
 */
export function useRecordCheck(data: MarketSnapshot | null, error: string) {
  const [result, setResult] = useState<RecordCheck | null>(null);
  const checks = result?.source === data ? result : null;
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    async function verify(source: MarketSnapshot) {
      let record: OnchainNav | null = null;
      let canonical: string | null = null;
      let chain: Check = { state: "pending", detail: "Waiting for a direct chain read." };
      let hash: Check = { state: "pending", detail: "Waiting for a matching document." };
      let nav: Check = { state: "pending", detail: "Waiting for the published composition." };
      let failure: string | null = null;
      try {
        if (source.registry.chainId !== PROOF_DEPLOYMENT.chainId || source.registry.address?.toLowerCase() !== PROOF_DEPLOYMENT.registry) throw new Error("The registry does not match the deployment pinned in this browser.");
        record = await readLatestNav(PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId });
        if (record.effectiveAt) {
          chain = { state: "pass", detail: "Read directly from the pinned registry on X Layer Testnet (1952)." };
          const entry = [source.latest?.publication, ...source.history].find(p => p?.holdingsHash.toLowerCase() === record!.holdingsHash.toLowerCase());
          if (entry) { canonical = entry.canonical; const verified = await verifyComposition(canonical, record); hash = verified.hash; nav = verified.nav; }
        }
      } catch (reason) { failure = reason instanceof Error ? reason.message : "Direct verification is unavailable."; chain = { state: "pending", detail: failure }; }
      if (!cancelled) setResult({ source, chain, hash, nav, record, canonical, error: failure });
    }
    void verify(data);
    return () => { cancelled = true; };
  }, [data]);
  const passed = checks && [checks.chain, checks.hash, checks.nav].every(c => c.state === "pass");
  const failed = checks && [checks.chain, checks.hash, checks.nav].some(c => c.state === "fail");
  const state: RecordCheckState = error || checks?.error ? "unavailable" : failed ? "failed" : passed ? "matched" : checks ? "waiting" : "loading";
  return { checks, state };
}
