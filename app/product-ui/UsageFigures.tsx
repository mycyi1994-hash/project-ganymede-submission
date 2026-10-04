"use client";

import { useEffect, useState } from "react";
import { formatUsdRounded } from "@/lib/nav-display";
import type { UsageSummary } from "@/lib/xstocks/usage";

type Served = UsageSummary & { askUstx?: { questions: number; since: string } };

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

/** Usage since launch from GET /api/v1/ustx/usage, with the team's and tests' wallets apart. */
export default function UsageFigures() {
  const [usage, setUsage] = useState<Served | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/ustx/usage", { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<Served> : Promise.reject(new Error("unavailable")))
      .then(setUsage)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  if (failed) return <p className="gmd-caption">Usage could not be read just now. It is also at <a href="/api/v1/ustx/usage">/api/v1/ustx/usage</a>.</p>;
  if (!usage) return <p className="gmd-caption" role="status">Reading usage…</p>;
  const figures: [string, string, string][] = [
    ["Wallets outside the team", usage.outside.wallets.toLocaleString("en-US"), `${usage.outside.activeLast7Days} active in the last 7 days`],
    ["Their actions on chain", usage.outside.actions.toLocaleString("en-US"), `${formatUsdRounded(usage.outside.volumeMicros)} in demo-dollar trades`],
    ["Team and test actions", usage.team.actions.toLocaleString("en-US"), `${usage.team.wallets} known wallets, load test included`],
    ["Questions to Ask USTX", (usage.askUstx?.questions ?? 0).toLocaleString("en-US"), `since ${day(usage.askUstx ? `${usage.askUstx.since}T00:00:00Z` : null)}`],
  ];
  return <><dl className="gmd-usage">{figures.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd><strong>{value}</strong><small>{note}</small></dd></div>)}</dl>
    <p className="gmd-caption">Every USTX fund, pool and lending event on X Layer Testnet since {day(usage.since)}, read to block {usage.toBlock.toLocaleString("en-US")}. Wallets not on our list may still be our own earlier manual tests. The list and the rule are in <a href="/api/v1/ustx/usage">/api/v1/ustx/usage</a>.</p></>;
}
