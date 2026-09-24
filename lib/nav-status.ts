export type PricingSnapshot = { evaluatedAt: string; status: string; retryAt?: string | null } | null;

export function publicationStatus(
  record: { effectiveAt: string | null } | null,
  latest: (NonNullable<PricingSnapshot> & { publication?: { status: string } | null }) | null,
  now: number,
  unavailable = false,
): { tone: "ready" | "waiting"; label: string; detail: string } {
  if (unavailable) return { tone: "waiting", label: "Publication status unavailable", detail: "Retry the read. Any displayed record is the last available snapshot." };
  const attempt = latest?.publication?.status;
  if (attempt === "failed") return { tone: "waiting", label: "Publication failed", detail: "The latest publication attempt failed. A previous record may still be verifiable." };
  if (attempt && attempt !== "confirmed") return { tone: "waiting", label: "Publication pending", detail: "The latest attempt is not confirmed. The displayed chain record may be older." };
  if (!record?.effectiveAt) return { tone: "waiting", label: "Awaiting publication", detail: "No published record is available to check." };
  const effective = Date.parse(record.effectiveAt);
  if (!Number.isFinite(effective) || effective > now + 60_000 || now - effective > 15 * 60_000) return { tone: "waiting", label: "Published record delayed", detail: "This is a historical record. Passing its checks does not make its prices current." };
  return { tone: "ready", label: "Recent record available", detail: "A recent record is available. Verify its document and calculation separately; this does not establish price accuracy." };
}

export function formatRecordTime(iso?: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function elapsedTime(iso: string | null | undefined, now: number): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min ago`;
  return `${Math.floor(hours / 24)} days ${hours % 24} hr ago`;
}

export function pricingStatus(latest: PricingSnapshot, now: number, unavailable = false): { tone: "ready" | "waiting"; label: string; detail: string } {
  if (unavailable) return { tone: "waiting", label: latest ? "Refresh unavailable" : "Pricing unavailable", detail: latest ? "Showing the last loaded record. Retry to check for an update." : "Pricing data could not be loaded. Retry to check its status." };
  if (!latest) return { tone: "waiting", label: "Awaiting first pricing", detail: "A new NAV needs a price for every holding." };
  if (!Number.isFinite(Date.parse(latest.evaluatedAt)) || now - Date.parse(latest.evaluatedAt) > 15 * 60_000) return { tone: "waiting", label: "Pricing update delayed", detail: "The recorded NAV is historical. A fresh pricing cycle has not completed recently." };
  if (latest.status !== "priced") return { tone: "waiting", label: latest.status === "awaiting_prices" ? "Awaiting fresh prices" : "Pricing not configured", detail: "No new NAV is published until every holding has an eligible price. The last record remains available." };
  return { tone: "ready", label: "Latest basket priced", detail: "A recent cycle accepted eligible quotes. Quote timestamps can be older than the cycle; publication and verification are separate steps." };
}
