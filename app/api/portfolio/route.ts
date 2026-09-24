import { engineEnv, jsonError, noStoreJson, readJson, requestIdentity, newPaperSession, isSameSiteRequest } from "@/lib/engine/api-helpers";
import { EngineRepository, LedgerRequestError } from "@/lib/engine/repository";

export const dynamic = "force-dynamic";

type PortfolioPayload = { productId?: unknown; amountKrw?: unknown; sharesMicros?: unknown; walletAddress?: unknown; clientReference?: unknown };

/** Parse the body and check each field's type; a bad value is the caller's to fix (400). */
async function readPayload(request: Request): Promise<PortfolioPayload> {
  let payload: unknown;
  try {
    payload = await readJson<unknown>(request);
  } catch {
    throw new LedgerRequestError("Send a JSON object with Content-Type: application/json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new LedgerRequestError("Send a JSON object");
  return payload as PortfolioPayload;
}

function productIdFrom(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) throw new LedgerRequestError("productId is required");
  return value;
}

/** Whole numbers only, as digits (or a safe integer), within 19 digits. */
function wholeNumber(value: unknown, field: string): bigint {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,19}$/.test(text)) throw new LedgerRequestError(`${field} must be a whole number`);
  return BigInt(text);
}

function clientReferenceFrom(value: unknown): string {
  if (value === undefined || value === null || value === "") return crypto.randomUUID();
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.trim())) throw new LedgerRequestError("clientReference must be up to 100 letters, digits or ._:-");
  return value.trim();
}

function walletFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function failure(error: unknown): Response {
  if (error instanceof LedgerRequestError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST" }, { status: 400 });
  return jsonError(error);
}

export async function GET(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    let identity = await requestIdentity(request);
    let cookie: string | undefined;
    if (!identity && engineEnv().TRADING_MODE !== "live") {
      const session = newPaperSession();
      cookie = session.cookie;
      identity = await requestIdentity(request, undefined, session.token);
    }
    if (!identity) return noStoreJson({ error: "Authenticated investor identity required" }, { status: 401 });
    const repo = new EngineRepository(engineEnv().DB);
    return noStoreJson(await repo.portfolio(identity.subject), { headers: cookie ? { "Set-Cookie": cookie } : undefined });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const payload = await readPayload(request);
    const identity = await requestIdentity(request, walletFrom(payload.walletAddress));
    if (!identity) return noStoreJson({ error: "Open your portfolio first to start a private session. Cookies must be enabled." }, { status: 401 });
    const productId = productIdFrom(payload.productId);
    const amountKrw = wholeNumber(payload.amountKrw ?? "", "amountKrw");
    const repo = new EngineRepository(engineEnv().DB);
    await repo.seed();
    const subscription = await repo.createSubscription({
      subject: identity.subject,
      email: identity.email,
      walletAddress: identity.walletAddress,
      productId,
      amountKrw,
      clientReference: clientReferenceFrom(payload.clientReference),
    });
    return noStoreJson({ subscription }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const payload = await readPayload(request);
    const identity = await requestIdentity(request, walletFrom(payload.walletAddress));
    if (!identity) return noStoreJson({ error: "Open your portfolio first to start a private session. Cookies must be enabled." }, { status: 401 });
    const productId = productIdFrom(payload.productId);
    const sharesMicros = wholeNumber(payload.sharesMicros ?? "", "sharesMicros");
    const repo = new EngineRepository(engineEnv().DB);
    await repo.seed();
    const redemption = await repo.createRedemption({
      subject: identity.subject,
      email: identity.email,
      walletAddress: identity.walletAddress,
      productId,
      sharesMicros,
      clientReference: clientReferenceFrom(payload.clientReference),
    });
    return noStoreJson({ redemption }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
