import { engineEnv, isSameSiteRequest, noStoreJson, readJson } from "@/lib/engine/api-helpers";
import { demoFailure, demoIdentity, orderId, parseOrder } from "@/lib/demo/api";
import { DemoLedger, DemoOrderError, executableNav } from "@/lib/demo/ledger";
import { demoFund } from "@/lib/funds/catalog";
import { EngineRepository } from "@/lib/engine/repository";
import { fundStateKey } from "@/lib/funds/cycle";
import type { Publication } from "@/lib/xstocks/cycle";
import type { AutocallDocument } from "@/lib/income/autocall";
import { fundLatestRecord } from "@/lib/funds/api";
import { ensureFundDemoTables, FundDemoLedger, type FundDb } from "@/lib/funds/demo";

export const dynamic = "force-dynamic";

/** Fills a demo order in one of the funds at its latest NAV recorded on X Layer. Demo dollars only. */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const identity = await demoIdentity(request, false);
    if (!identity) return noStoreJson({ error: "Open the demo account first. Cookies must be enabled.", code: "no_session" }, { status: 401 });
    let body: unknown;
    try { body = await readJson<unknown>(request); } catch { throw new DemoOrderError("Send a JSON object with Content-Type: application/json."); }
    const fund = demoFund(typeof (body as { fundId?: unknown })?.fundId === "string" ? (body as { fundId: string }).fundId : "");
    if (!fund) throw new DemoOrderError("Choose one of the funds.", 400, "unknown_fund");
    const input = parseOrder(body);
    const db = engineEnv().DB as unknown as FundDb;
    await ensureFundDemoTables(db);
    const demo = new FundDemoLedger(db);
    // The id covers the fund too, so the same client id in two funds never collides.
    const id = await orderId(identity.subject, `${fund.id}-${input.clientOrderId}`);
    // Recover a committed order even when the NAV/RPC is no longer available on retry.
    const existing = await demo.order(identity.subject, id);
    let result;
    if (existing) result = { order: existing, replayed: true };
    else {
      const record = await fundLatestRecord(fund);
      if (fund.kind === "autocall") await noteOpen(input.side, record.holdingsHash, fund.id);
      result = await demo.place(identity.subject, fund.id, { id, side: input.side, usdMicros: input.usdMicros, sharesMicros: input.sharesMicros }, executableNav(record, Date.now()), new Date());
    }
    const { account, positions } = await new DemoLedger(engineEnv().DB).portfolio(identity.subject);
    return noStoreJson({ ...result, cashMicros: account.cashMicros, positions }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return demoFailure(error);
  }
}

/**
 * A note (an ELS) takes new money at face value while it is live and its subscription is open, and is
 * not sold back: holders are paid when it is called or matures.
 */
async function noteOpen(side: "subscribe" | "redeem", holdingsHash: string, fundId: string): Promise<void> {
  if (side === "redeem") throw new DemoOrderError("This note is not sold back before it ends. It pays automatically when it is called early or matures.", 400, "not_redeemable");
  const history = JSON.parse((await new EngineRepository(engineEnv().DB).getState(fundStateKey(fundId, "history")))?.value ?? "[]") as Publication[];
  const entry = history.find((item) => item.holdingsHash.toLowerCase() === holdingsHash.toLowerCase());
  const document = entry ? JSON.parse(entry.canonical) as AutocallDocument : null;
  if (!document || document.state.status !== "live") throw new DemoOrderError("This note has ended and takes no new money.", 400, "note_closed");
  if (Date.now() > Date.parse(document.subscriptionEndsAt)) throw new DemoOrderError(`Subscriptions to this note closed on ${document.subscriptionEndsAt.slice(0, 10)}.`, 400, "note_closed");
}
