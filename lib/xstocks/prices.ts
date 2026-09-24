/**
 * Live xStocks prices from OKX OnchainOS (DEX market price API) on X Layer.
 *
 * Auth follows the OnchainOS scheme: OK-ACCESS-SIGN =
 * base64(HMAC-SHA256(timestamp + method + requestPath + body, secret)).
 */
import { parseDecimalMicros, XSTOCKS_CHAIN, type Quote } from "./basket";

export const ONCHAINOS_BASE_URL = "https://web3.okx.com";
export const PRICE_PATH = "/api/v6/dex/market/price";
export const PRICE_SOURCE = "okx-onchainos-dex-market-price";

export type OnchainOsCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
  projectId?: string;
  /** Defaults to ONCHAINOS_BASE_URL; overridable for a proxy or a local mock. */
  baseUrl: string;
};

export type OnchainOsEnv = {
  OKX_API_KEY?: string;
  OKX_API_SECRET?: string;
  OKX_API_PASSPHRASE?: string;
  OKX_PROJECT_ID?: string;
  ONCHAINOS_BASE_URL?: string;
};

export function onchainOsCredentials(env: OnchainOsEnv): OnchainOsCredentials | null {
  if (!env.OKX_API_KEY || !env.OKX_API_SECRET || !env.OKX_API_PASSPHRASE) return null;
  return {
    apiKey: env.OKX_API_KEY,
    secret: env.OKX_API_SECRET,
    passphrase: env.OKX_API_PASSPHRASE,
    projectId: env.OKX_PROJECT_ID || undefined,
    baseUrl: (env.ONCHAINOS_BASE_URL || ONCHAINOS_BASE_URL).replace(/\/$/, ""),
  };
}

async function hmacBase64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** requestPath includes the query string for GET requests. */
export async function signedHeaders(credentials: OnchainOsCredentials, method: "GET" | "POST", requestPath: string, body = "", timestamp = new Date().toISOString()): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": credentials.apiKey,
    "OK-ACCESS-SIGN": await hmacBase64(credentials.secret, `${timestamp}${method}${requestPath}${body}`),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": credentials.passphrase,
    "Content-Type": "application/json",
  };
  if (credentials.projectId) headers["OK-ACCESS-PROJECT"] = credentials.projectId;
  return headers;
}

/** OnchainOS returns epoch milliseconds as a string; accept seconds or ISO too. */
export function normalizeQuoteTime(value: unknown): string {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

type PriceRow = { chainIndex?: string; tokenContractAddress?: string; price?: string; time?: string | number };

export async function fetchXStockQuotes(
  credentials: OnchainOsCredentials | null,
  constituents: Array<{ symbol: string; address: string | null }>,
  fetcher: typeof fetch = fetch,
): Promise<{ quotes: Map<string, Quote>; warnings: string[]; retryAt?: string }> {
  const quotes = new Map<string, Quote>();
  const priced = constituents.filter((constituent): constituent is { symbol: string; address: string } => Boolean(constituent.address));
  if (!credentials) return { quotes, warnings: ["OKX OnchainOS credentials are not configured (OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE)"] };
  if (priced.length === 0) return { quotes, warnings: ["No xStocks addresses configured"] };

  const body = JSON.stringify(priced.map((constituent) => ({ chainIndex: XSTOCKS_CHAIN.chainIndex, tokenContractAddress: constituent.address.toLowerCase() })));
  try {
    // Only transient server errors get one bounded retry. Rate limits wait for
    // the next scheduled cycle rather than adding pressure to the provider.
    let response!: Response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetcher(`${credentials.baseUrl}${PRICE_PATH}`, {
        method: "POST",
        headers: await signedHeaders(credentials, "POST", PRICE_PATH, body),
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (![502, 503, 504].includes(response.status) || attempt === 1) break;
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!response.ok) {
      const limited = response.status === 429 || response.status === 403;
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      const retryAt = limited ? new Date(Date.now() + Math.max(10 * 60_000, Number.isFinite(retryMs) ? retryMs : 0)).toISOString() : undefined;
      return { quotes, retryAt, warnings: [`OnchainOS price API HTTP ${response.status}${limited ? ": provider access or rate limit; waiting before retry" : ": service unavailable"}`] };
    }
    const payload = await response.json() as { code?: string | number; msg?: string; data?: PriceRow[] };
    if (String(payload.code) !== "0") {
      return { quotes, warnings: [`OnchainOS price API ${response.status}: ${payload.msg || `code ${payload.code}`}`] };
    }
    const warnings: string[] = [];
    for (const constituent of priced) {
      const row = payload.data?.find((candidate) => String(candidate.chainIndex) === XSTOCKS_CHAIN.chainIndex && candidate.tokenContractAddress?.toLowerCase() === constituent.address.toLowerCase());
      if (!row?.price) {
        warnings.push(`OnchainOS returned no price for ${constituent.symbol}`);
        continue;
      }
      try {
        quotes.set(constituent.symbol, {
          symbol: constituent.symbol,
          address: constituent.address,
          priceMicros: parseDecimalMicros(row.price),
          time: normalizeQuoteTime(row.time),
          source: PRICE_SOURCE,
        });
      } catch (error) {
        warnings.push(`${constituent.symbol}: ${error instanceof Error ? error.message : "unreadable price"}`);
      }
    }
    return { quotes, warnings };
  } catch (error) {
    return { quotes, warnings: [`OnchainOS price API unreachable: ${error instanceof Error ? error.message : "unknown error"}`] };
  }
}
