import { engineEnv, isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { FaucetError, dripGas, faucetSender } from "@/lib/faucet";

export const dynamic = "force-dynamic";

/** Sends a first-time wallet a little test OKB for network fees. Same-site only. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const env = engineEnv();
    if (!env.FAUCET_PRIVATE_KEY) throw new FaucetError("Test OKB is not available here. Use the OKX faucet.", 503, "not_configured");
    let body: { address?: unknown };
    try { body = await request.json() as { address?: unknown }; } catch { throw new FaucetError("Send a wallet address.", 400, "bad_address"); }
    const visitor = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    return noStoreJson(await dripGas({ db: env.DB, address: body?.address, visitor, now: new Date(), send: faucetSender(env.FAUCET_PRIVATE_KEY) }));
  } catch (error) {
    if (error instanceof FaucetError) return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
    console.error("Faucet failed", error instanceof Error ? error.name : "error");
    return noStoreJson({ error: "Test OKB is unavailable right now. Use the OKX faucet.", code: "failed" }, { status: 500 });
  }
}
