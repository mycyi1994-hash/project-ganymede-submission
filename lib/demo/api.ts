/** Request handling shared by the demo investing routes. */
import { engineEnv, jsonError, newPaperSession, noStoreJson, requestIdentity } from "../engine/api-helpers";
import { sha256Hex } from "../engine/fixed";
import { SettlementClient } from "../engine/settlement";
import { readLatestNav, type OnchainNav } from "../xstocks/onchain";
import { fundRpc, parseStoredWalletTotals, readFundTotals, STATE_WALLET_SHARES, type StoredWalletTotals } from "../xstocks/fund";
import { DemoLedger, DemoOrderError, type DemoFund, type DemoSide } from "./ledger";

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

export type WalletTotals = { sharesMicros: string; investors: number; block: number };
let walletCache: { at: number; value: WalletTotals } | null = null;

/**
 * USTX held in wallets and the number of wallets holding it, read from the fund contract on
 * X Layer Testnet (cached for 30 seconds per isolate). If the chain cannot be read, the value the
 * last cycle stored; otherwise null. Reads only.
 */
export async function walletTotals(now = Date.now()): Promise<WalletTotals | null> {
  if (walletCache && now - walletCache.at < 30_000) return walletCache.value;
  try {
    const totals = await readFundTotals({ rpc: fundRpc({ signal: AbortSignal.timeout(6_000) }) });
    walletCache = { at: now, value: { sharesMicros: totals.sharesMicros.toString(), investors: totals.investors, block: totals.block } };
    return walletCache.value;
  } catch {
    try {
      const row = await engineEnv().DB.prepare("SELECT value FROM engine_state WHERE key = ?").bind(STATE_WALLET_SHARES).first<{ value: string }>();
      const stored: StoredWalletTotals | null = parseStoredWalletTotals(row?.value);
      return stored ? { sharesMicros: stored.sharesMicros, investors: stored.investors, block: stored.block } : null;
    } catch { return null; }
  }
}

export type FundSummary = DemoFund & { demo: { sharesMicros: string; investors: number }; wallets: WalletTotals | null };

/** Fund totals across demo balances and wallets; 24-hour flows cover demo-balance orders. */
export function combineFund(demo: DemoFund, wallets: WalletTotals | null): FundSummary {
  return {
    ...demo,
    sharesOutstandingMicros: (BigInt(demo.sharesOutstandingMicros) + BigInt(wallets?.sharesMicros ?? "0")).toString(),
    investors: demo.investors + (wallets?.investors ?? 0),
    demo: { sharesMicros: demo.sharesOutstandingMicros, investors: demo.investors },
    wallets,
  };
}
