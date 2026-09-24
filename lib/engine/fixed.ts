const TEXT_ENCODER = new TextEncoder();

export const BPS_SCALE = 10_000;
export const SHARE_SCALE = 1_000_000n;

export function asBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.round(value));
  return BigInt(value || "0");
}

export function mulDiv(value: bigint, multiplier: bigint, divisor: bigint): bigint {
  if (divisor === 0n) throw new Error("Division by zero");
  return value * multiplier / divisor;
}

export function unitsToMarketValueKrw(unitsAtomic: bigint, priceKrw: bigint, decimals: number): bigint {
  return mulDiv(unitsAtomic, priceKrw, 10n ** BigInt(decimals));
}

export function notionalToUnitsAtomic(notionalKrw: bigint, priceKrw: bigint, decimals: number): bigint {
  if (priceKrw <= 0n) throw new Error("Price must be positive");
  return mulDiv(notionalKrw, 10n ** BigInt(decimals), priceKrw);
}

export function sharesForSubscription(amountKrw: bigint, navPerShareMicros: bigint): bigint {
  if (navPerShareMicros <= 0n) throw new Error("NAV must be positive");
  return mulDiv(amountKrw, SHARE_SCALE * SHARE_SCALE, navPerShareMicros);
}

export function krwForShares(sharesMicros: bigint, navPerShareMicros: bigint): bigint {
  return mulDiv(sharesMicros, navPerShareMicros, SHARE_SCALE * SHARE_SCALE);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? TEXT_ENCODER.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
