import { engineEnv } from "@/lib/engine/api-helpers";
import { cachedRead } from "@/lib/read-cache";
import { poolsForRequest } from "@/lib/xstocks/pools-api";

export const dynamic = "force-dynamic";

// Any site or app may read this: public chain state, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

/**
 * Each Worker isolate keeps what it served for 30 seconds. Behind that, the once-a-minute cron's
 * snapshot is served while under 90 seconds old, and X Layer is read only when it is older; when
 * X Layer cannot be read, a snapshot up to 10 minutes old is served, marked stale.
 */
export const POOLS_FRESH_MS = 30_000;
export const POOLS_STALE_MS = 10 * 60_000;

/** USTX's liquidity pools on X Layer Testnet, read at readAt. Reads only. */
export async function GET() {
  try {
    const { value, stale } = await cachedRead("ustx-pools", () => poolsForRequest(engineEnv().DB, POOLS_STALE_MS), { freshMs: POOLS_FRESH_MS, staleMs: POOLS_STALE_MS });
    const isStale = stale || value.stale;
    return json({ ...value.body, readAt: new Date(value.readAt).toISOString(), stale: isStale }, 200, isStale ? "public, max-age=15" : "public, max-age=30");
  } catch (error) {
    console.error("Public pools read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    return json({ error: "The pools on X Layer Testnet could not be read. Try again shortly.", code: "pools_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
