import { createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "./engine/fixed";
import { FUND_DEPLOYMENT, fundRpc, quantity, type Rpc } from "./xstocks/fund";
import { FAUCET_TERMS } from "./faucet-terms";

/**
 * Sends a first-time wallet a little X Layer Testnet OKB for network fees, from the Worker secret
 * FAUCET_PRIVATE_KEY: a key used for nothing else, holding only test OKB, with no role on any
 * contract. Each wallet gets one drip, only while it holds almost none, within a per-visitor and a
 * per-site daily allowance.
 */
export class FaucetError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type D1 = {
  prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> } };
  batch(statements: unknown[]): Promise<unknown>;
};

export type Drip = { hash: string; wei: string };
export type Sender = (to: `0x${string}`, wei: bigint) => Promise<string>;

const xLayerTestnet = defineChain({
  id: FUND_DEPLOYMENT.chainId,
  name: FUND_DEPLOYMENT.name,
  nativeCurrency: FUND_DEPLOYMENT.nativeCurrency,
  rpcUrls: { default: { http: [FUND_DEPLOYMENT.rpcUrl] } },
});

export function faucetSender(privateKey: string): Sender {
  const client = createWalletClient({ account: privateKeyToAccount(privateKey as `0x${string}`), chain: xLayerTestnet, transport: http(FUND_DEPLOYMENT.rpcUrl, { timeout: 12_000 }) });
  return (to, wei) => client.sendTransaction({ to, value: wei });
}

export async function dripGas(input: { db: D1; address: unknown; visitor: string; now: Date; send: Sender; rpc?: Rpc }): Promise<Drip> {
  const { db, visitor, now, send } = input;
  if (typeof input.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.address)) throw new FaucetError("Send a wallet address.", 400, "bad_address");
  const address = input.address.toLowerCase() as `0x${string}`;
  const rpc = input.rpc ?? fundRpc();
  const balance = quantity(await rpc("eth_getBalance", [address, "latest"]).catch(() => { throw new FaucetError("X Layer Testnet could not be read. Try again in a moment.", 503, "unavailable"); }));
  if (balance >= FAUCET_TERMS.lowWei) throw new FaucetError("This wallet already has test OKB for network fees.", 409, "has_gas");

  const day = now.toISOString().slice(0, 10);
  const at = now.toISOString();
  const walletKey = `faucet:wallet:${address}`;
  const claimed = await db.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, 'pending', ?) ON CONFLICT(key) DO NOTHING").bind(walletKey, at).run();
  if (!claimed.meta?.changes) throw new FaucetError("This wallet has already received test OKB here. Get more from the OKX faucet.", 429, "wallet_done");
  const release = () => db.prepare("DELETE FROM engine_state WHERE key = ?").bind(walletKey).run();

  const siteKey = `faucet:site:${day}`;
  const visitorKey = `faucet:visitor:${day}:${(await sha256Hex(`${day}:${visitor}`)).slice(0, 32)}`;
  const count = (key: string) => db.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at").bind(key, at).run();
  const read = async (key: string) => Number((await db.prepare("SELECT value FROM engine_state WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? 0);
  // The visitor's own allowance first: a visitor past it is refused before the site's is counted,
  // so one visitor cannot spend the site's day.
  await count(visitorKey);
  if (await read(visitorKey) > FAUCET_TERMS.perVisitorPerDay) {
    await release();
    throw new FaucetError("You have asked for test OKB for several wallets today. Try again after 00:00 UTC.", 429, "limit");
  }
  await count(siteKey);
  const site = await read(siteKey);
  if (site === 1) await db.prepare("DELETE FROM engine_state WHERE (key LIKE 'faucet:site:%' OR key LIKE 'faucet:visitor:%') AND updated_at < ?").bind(`${day}T00:00:00.000Z`).run();
  if (site > FAUCET_TERMS.perSitePerDay) {
    await release();
    throw new FaucetError("Today's test OKB here has run out. Get some from the OKX faucet, or try after 00:00 UTC.", 429, "limit");
  }

  let hash: string;
  try {
    hash = await send(address, FAUCET_TERMS.dripWei);
  } catch (error) {
    await release();
    console.error("Faucet send failed", error instanceof Error ? error.name : "error");
    throw new FaucetError("The test OKB could not be sent just now. Try again in a moment, or use the OKX faucet.", 503, "send_failed");
  }
  await db.prepare("UPDATE engine_state SET value = ?, updated_at = ? WHERE key = ?").bind(hash, at, walletKey).run();
  return { hash, wei: FAUCET_TERMS.dripWei.toString() };
}
