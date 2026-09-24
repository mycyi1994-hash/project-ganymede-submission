/** Request handling shared by the demo investing routes. */
import { engineEnv, jsonError, newPaperSession, noStoreJson, requestIdentity } from "../engine/api-helpers";
import { sha256Hex } from "../engine/fixed";
import { SettlementClient } from "../engine/settlement";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { DemoLedger, DemoOrderError, type DemoSide } from "./ledger";

export type DemoOrderInput = { side: DemoSide; clientOrderId: string; usdMicros?: bigint; sharesMicros?: bigint };

const MICROS = /^\d{1,16}$/;

export function parseOrder(value: unknown): DemoOrderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DemoOrderError("Send a JSON object.");
  const body = value as Record<string, unknown>;
  if (body.side !== "subscribe" && body.side !== "redeem") throw new DemoOrderError("side must be subscribe or redeem.");
  if (typeof body.clientOrderId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.clientOrderId)) throw new DemoOrderError("clientOrderId must be 8 to 64 letters, digits or dashes.");
  const field = body.side === "subscribe" ? "usdMicros" : "sharesMicros";
  const amount = body[field];
  if (typeof amount !== "string" || !MICROS.test(amount)) throw new DemoOrderError(`${field} must be a whole number of micros.`);
  return body.side === "subscribe"
    ? { side: "subscribe", clientOrderId: body.clientOrderId, usdMicros: BigInt(amount) }
    : { side: "redeem", clientOrderId: body.clientOrderId, sharesMicros: BigInt(amount) };
}

/** One stored id per session and client order id: a retry replays, another session cannot collide. */
export async function orderId(subject: string, clientOrderId: string): Promise<string> {
  return `ord_${(await sha256Hex(`${subject}:${clientOrderId}`)).replace(/^0x/, "").slice(0, 32)}`;
}

export function ledger(): DemoLedger {
  return new DemoLedger(engineEnv().DB);
}

/** The private session for this browser, creating one (a cookie only, no database write) when asked. */
export async function demoIdentity(request: Request, create: boolean): Promise<{ subject: string; cookie?: string } | null> {
  const identity = await requestIdentity(request);
  if (identity) return { subject: identity.subject };
  if (!create || engineEnv().TRADING_MODE === "live") return null;
  const session = newPaperSession();
  const created = await requestIdentity(request, undefined, session.token);
  return created ? { subject: created.subject, cookie: session.cookie } : null;
}

/** The latest USTX record on X Layer, read directly; upstream detail stays in the operator log. */
export async function latestRecord(): Promise<OnchainNav> {
  const env = engineEnv();
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new DemoOrderError("The NAV registry is not configured.", 503, "nav_unavailable");
  const settlement = new SettlementClient(env);
  try {
    return await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId });
  } catch (error) {
    console.error("Demo order NAV read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    throw new DemoOrderError("The NAV record on X Layer could not be read. Try again in a moment.", 503, "nav_unavailable");
  }
}

export function demoFailure(error: unknown): Response {
  if (error instanceof DemoOrderError) return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
  return jsonError(error);
}
