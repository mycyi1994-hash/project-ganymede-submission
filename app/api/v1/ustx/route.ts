import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { SettlementClient } from "@/lib/engine/settlement";
import { XSTOCKS_CHAIN, XSTOCKS_PRODUCT } from "@/lib/xstocks/basket";
import { STATE_CONFIRMED, STATE_HISTORY, type Publication } from "@/lib/xstocks/cycle";
import { readLatestNav } from "@/lib/xstocks/onchain";

export const dynamic = "force-dynamic";

// Any site or app may read this: a public record, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

const usd = (micros: string) => `${BigInt(micros) / 1_000_000n}.${(BigInt(micros) % 1_000_000n).toString().padStart(6, "0")}`;

/** The latest USTX NAV record, read from the registry on X Layer at request time. Reads only. */
export async function GET(request: Request) {
  const env = engineEnv();
  const origin = new URL(request.url).origin;
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  const settlement = new SettlementClient(env);
  try {
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new Error("The NAV registry is not configured.");
    const record = await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId });
    if (!record.effectiveAt) throw new Error("No NAV has been recorded yet.");
    // The transaction hash is a convenience from this server's log; the record itself came from the chain.
    let transactionHash: string | null = null;
    try {
      const repo = new EngineRepository(env.DB);
      const [history, confirmed] = await Promise.all([repo.getState(STATE_HISTORY), repo.getState(STATE_CONFIRMED)]);
      const entries = [...(history ? JSON.parse(history.value) as Publication[] : []), ...(confirmed ? [JSON.parse(confirmed.value) as Publication] : [])];
      const match = entries.find(entry => entry.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof entry.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.txHash));
      transactionHash = match?.txHash ?? null;
    } catch { /* The record stands without it. */ }
    return json({
      product: { id: XSTOCKS_PRODUCT.id, ticker: "USTX", name: "US Tech Basket", constituents: ["AAPLx", "MSFTx", "NVDAx", "AMZNx", "METAx", "TSLAx"] },
      nav: {
        perShareUsd: usd(record.navPerShareMicros),
        perShareMicros: record.navPerShareMicros,
        sharesOutstandingMicros: record.sharesOutstandingMicros,
        effectiveAt: record.effectiveAt,
        recordedAt: record.publishedAt,
        holdingsHash: record.holdingsHash,
      },
      record: {
        network: settlement.chain.name,
        chainId: settlement.chain.chainId,
        registry: registry.toLowerCase(),
        transactionHash,
        explorerUrl: transactionHash ? `${settlement.chain.explorerUrl}/tx/${transactionHash}` : `${settlement.chain.explorerUrl}/address/${registry.toLowerCase()}`,
      },
      pricing: { source: "OKX OnchainOS", chain: XSTOCKS_CHAIN.name, chainIndex: XSTOCKS_CHAIN.chainIndex, interval: "5 minutes" },
      verify: {
        page: `${origin}/products/ustx/transparency`,
        documents: `${origin}/api/xstocks`,
        rule: "sha256 of the composition document equals holdingsHash, and the sum of token units × price equals perShareMicros.",
      },
      environment: "X Layer Testnet record of a model basket. Demo investing only; not an offer.",
    }, 200, "public, max-age=30");
  } catch (error) {
    console.error("Public NAV read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    return json({ error: "The NAV record on X Layer could not be read. Try again shortly.", code: "nav_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
