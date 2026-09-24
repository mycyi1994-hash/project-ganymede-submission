import { env } from "cloudflare:workers";
import { sha256Hex } from "./fixed";
import type { EngineEnv } from "./types";

export function engineEnv(): EngineEnv {
  return env as unknown as EngineEnv;
}

export type RequestIdentity = {
  subject: string;
  email: string | null;
  walletAddress: string | null;
};

function walletFromRequest(request: Request, payloadWallet?: unknown): string | null {
  const raw = typeof payloadWallet === "string" ? payloadWallet : request.headers.get("x-ganymede-wallet");
  return raw && /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null;
}

function authenticatedEmail(request: Request): string | null {
  const trusted = engineEnv().IDENTITY_HEADER_TRUSTED;
  if (trusted !== "true" && trusted !== "1") return null;
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || null;
}

const PAPER_COOKIE = "__Host-ganymede-paper";

export function paperSessionCookie(request: Request): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${PAPER_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(PAPER_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function newPaperSession(): { cookie: string; token: string } {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { token, cookie: `${PAPER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000` };
}

// A wallet address is metadata, never proof of ownership. Only the private cookie
// (hashed before use in the ledger) or an explicitly trusted edge identifies a user.
export async function requestIdentity(request: Request, payloadWallet?: unknown, newToken?: string): Promise<RequestIdentity | null> {
  const email = authenticatedEmail(request);
  const walletAddress = walletFromRequest(request, payloadWallet);
  if (email) return { subject: `email:${email}`, email, walletAddress };
  if (engineEnv().TRADING_MODE === "live") return null;
  const token = paperSessionCookie(request) ?? newToken;
  return token ? { subject: `paper-session:${await sha256Hex(token)}`, email: null, walletAddress } : null;
}

export function isSameSiteRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function constantTimeTokenMatch(expected: string, supplied: string): Promise<boolean> {
  const [expectedHash, suppliedHash] = await Promise.all([sha256Hex(expected), sha256Hex(supplied)]);
  if (expectedHash.length !== suppliedHash.length) return false;
  let different = 0;
  for (let index = 0; index < expectedHash.length; index += 1) different |= expectedHash.charCodeAt(index) ^ suppliedHash.charCodeAt(index);
  return different === 0;
}

export async function operatorIdentity(request: Request): Promise<string | null> {
  const currentEnv = engineEnv();
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (currentEnv.OPERATOR_TOKEN && suppliedToken && await constantTimeTokenMatch(currentEnv.OPERATOR_TOKEN, suppliedToken)) return "operator:token";

  const email = authenticatedEmail(request);
  const allowlist = (currentEnv.OPERATIONS_ALLOW_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (email && (allowlist.includes(email) || (currentEnv.TRADING_MODE !== "live" && allowlist.length === 0))) return `operator:${email}`;
  return null;
}

export function jsonError(error: unknown, status = 500): Response {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const missingTable = /no such table|has no column|no such column/i.test(message);
  const quota = /D1.*(?:limit|quota)|(?:limit|quota).*D1|too many (?:reads|writes)|daily.*(?:read|write)/i.test(message);
  const database = /D1_ERROR/i.test(message);
  const code = missingTable ? "DATABASE_SCHEMA_MISSING" : quota ? "DATABASE_CAPACITY" : database ? "DATABASE_UNAVAILABLE" : "REQUEST_FAILED";
  const detail = missingTable ? "The database schema is unavailable. Please contact the operator."
    : quota ? "Database capacity has been reached. Please try again later."
    : database ? "The database is temporarily unavailable. Please try again."
    : message;
  return noStoreJson({ error: detail, code }, { status: quota || database ? 503 : status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Content-Type must be application/json");
  return await request.json() as T;
}

export function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}
