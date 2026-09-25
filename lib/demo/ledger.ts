/**
 * Demo investing in USTX with demo dollars. No real money moves and no shares
 * are issued on chain: an account is a private browser session that starts
 * with $10,000 demo dollars, and every order fills at the latest NAV recorded
 * on X Layer, the same record visitors verify in their browser.
 *
 * Amounts are integer micros. Shares use six decimals, like the NAV.
 */
import type { OnchainNav } from "../xstocks/onchain";

export const DEMO_START_CASH_MICROS = 10_000_000_000n;
export const DEMO_MIN_ORDER_MICROS = 10_000_000n;
/** Order attempts per UTC day across all accounts; guards the write budget NAV publication needs. */
export const DEMO_DAILY_ORDER_CAP = 2_000;
export const DEMO_NAV_MAX_AGE_MS = 60 * 60_000;
export const DEMO_ORDER_HISTORY = 20;
const SHARE = 1_000_000n;

export type DemoSide = "subscribe" | "redeem";
export type DemoAccount = { cashMicros: string; sharesMicros: string; costMicros: string; ordersCount: number; exists: boolean };
export type DemoOrder = { id: string; side: DemoSide; usdMicros: string; sharesMicros: string; navMicros: string; navEffectiveAt: string; navHoldingsHash: string; createdAt: string };
export type ExecutableNav = { navMicros: bigint; effectiveAt: string; holdingsHash: string };

export class DemoOrderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "invalid_order") { super(message); this.status = status; this.code = code; }
}

export const sharesForUsd = (usdMicros: bigint, navMicros: bigint) => usdMicros * SHARE / navMicros;
export const usdForShares = (sharesMicros: bigint, navMicros: bigint) => sharesMicros * navMicros / SHARE;
/** Average cost: a redemption removes the same fraction of cost as of shares. */
export function costRemoved(costMicros: bigint, heldShares: bigint, redeemedShares: bigint): bigint {
  return redeemedShares >= heldShares ? costMicros : costMicros * redeemedShares / heldShares;
}

/** The recorded NAV an order may fill at: present, positive and at most an hour old. */
export function executableNav(record: OnchainNav | null, now: number): ExecutableNav {
  if (!record?.effectiveAt) throw new DemoOrderError("No NAV has been recorded on X Layer yet.", 503, "nav_unavailable");
  if (now - Date.parse(record.effectiveAt) > DEMO_NAV_MAX_AGE_MS) throw new DemoOrderError("The latest NAV on X Layer is more than an hour old, so orders are paused until the next record.", 503, "nav_stale");
  const navMicros = BigInt(record.navPerShareMicros);
  if (navMicros <= 0n) throw new DemoOrderError("The recorded NAV is not usable.", 503, "nav_unavailable");
  return { navMicros, effectiveAt: record.effectiveAt, holdingsHash: record.holdingsHash };
}

type AccountRow = { cash_micros: number; shares_micros: number; cost_micros: number; orders_count: number };
type OrderRow = { id: string; side: DemoSide; usd_micros: number; shares_micros: number; nav_micros: number; nav_effective_at: string; nav_holdings_hash: string; created_at: string };

const newAccount = (): DemoAccount => ({ cashMicros: DEMO_START_CASH_MICROS.toString(), sharesMicros: "0", costMicros: "0", ordersCount: 0, exists: false });
const toAccount = (row: AccountRow): DemoAccount => ({ cashMicros: String(row.cash_micros), sharesMicros: String(row.shares_micros), costMicros: String(row.cost_micros), ordersCount: row.orders_count, exists: true });
const toOrder = (row: OrderRow): DemoOrder => ({ id: row.id, side: row.side, usdMicros: String(row.usd_micros), sharesMicros: String(row.shares_micros), navMicros: String(row.nav_micros), navEffectiveAt: row.nav_effective_at, navHoldingsHash: row.nav_holdings_hash, createdAt: row.created_at });
/** D1 binds numbers, not bigints; every demo amount stays far below 2^53. */
function bindable(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new DemoOrderError("The amount is too large.");
  return number;
}

/** Fund totals only: no single order, amount or time that could point at an investor. */
export type DemoFund = { sharesOutstandingMicros: string; investors: number; ordersToday: number; last24h: { investedMicros: string; redeemedMicros: string; orders: number } };

/** Demo shares held across all accounts: "0" without a database, null when the demo tables cannot be read. */
export async function demoSharesOutstanding(db: D1Database | undefined): Promise<string | null> {
  if (!db) return "0";
  try {
    const row = await db.prepare("SELECT COALESCE(SUM(shares_micros), 0) AS shares FROM demo_accounts").first<{ shares: number }>();
    return String(row?.shares ?? 0);
  } catch { return null; }
}

export class DemoLedger {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async account(subject: string): Promise<DemoAccount> {
    const row = await this.db.prepare("SELECT cash_micros, shares_micros, cost_micros, orders_count FROM demo_accounts WHERE subject = ?").bind(subject).first<AccountRow>();
    return row ? toAccount(row) : newAccount();
  }

  async orders(subject: string, limit = DEMO_ORDER_HISTORY): Promise<DemoOrder[]> {
    const { results } = await this.db.prepare("SELECT id, side, usd_micros, shares_micros, nav_micros, nav_effective_at, nav_holdings_hash, created_at FROM demo_orders WHERE subject = ? ORDER BY created_at DESC, id DESC LIMIT ?").bind(subject, limit).all<OrderRow>();
    return results.map(toOrder);
  }

  async order(subject: string, id: string): Promise<DemoOrder | null> {
    const row = await this.db.prepare("SELECT id, side, usd_micros, shares_micros, nav_micros, nav_effective_at, nav_holdings_hash, created_at FROM demo_orders WHERE subject = ? AND id = ?").bind(subject, id).first<OrderRow>();
    return row ? toOrder(row) : null;
  }

  /**
   * Fills one order in a single transaction. The account row is created on the first
   * order, the cash or share condition and the daily cap are checked in the same UPDATE,
   * and the order is written only if that UPDATE marked the account with its id. A retry
   * with the same id fails on the primary key and rolls the whole batch back.
   */
  async place(subject: string, input: { id: string; side: DemoSide; usdMicros?: bigint; sharesMicros?: bigint }, nav: ExecutableNav, now: Date): Promise<{ order: DemoOrder; account: DemoAccount; replayed: boolean }> {
    const existing = await this.order(subject, input.id);
    if (existing) return { order: existing, account: await this.account(subject), replayed: true };
    const current = await this.account(subject);
    let usd: bigint, shares: bigint, cashDelta: bigint, sharesDelta: bigint, costDelta: bigint, guard: string, guardValues: number[];
    if (input.side === "subscribe") {
      usd = input.usdMicros ?? 0n;
      if (usd < DEMO_MIN_ORDER_MICROS) throw new DemoOrderError("The minimum order is $10.");
      if (usd > BigInt(current.cashMicros)) throw new DemoOrderError("That is more than your demo cash.", 409, "insufficient_cash");
      shares = sharesForUsd(usd, nav.navMicros);
      if (shares <= 0n) throw new DemoOrderError("That amount buys no shares.");
      [cashDelta, sharesDelta, costDelta] = [-usd, shares, usd];
      guard = "cash_micros >= ?"; guardValues = [bindable(usd)];
    } else {
      shares = input.sharesMicros ?? 0n;
      const held = BigInt(current.sharesMicros);
      if (shares <= 0n) throw new DemoOrderError("Enter the number of shares to redeem.");
      if (shares > held) throw new DemoOrderError("That is more than the shares you hold.", 409, "insufficient_shares");
      usd = usdForShares(shares, nav.navMicros);
      if (usd <= 0n) throw new DemoOrderError("That many shares is worth less than one micro-dollar.");
      [cashDelta, sharesDelta, costDelta] = [usd, -shares, -costRemoved(BigInt(current.costMicros), held, shares)];
      // The cost removed depends on the holding read above, so the update requires it unchanged.
      guard = "shares_micros = ? AND cost_micros = ?"; guardValues = [bindable(held), bindable(BigInt(current.costMicros))];
    }
    const at = now.toISOString();
    const day = at.slice(0, 10);
    const statements = [
      this.db.prepare("INSERT OR IGNORE INTO demo_accounts (subject, cash_micros, shares_micros, cost_micros, orders_count, last_order_id, created_at, updated_at) VALUES (?, ?, 0, 0, 0, NULL, ?, ?)").bind(subject, bindable(DEMO_START_CASH_MICROS), at, at),
      this.db.prepare("INSERT INTO demo_daily (day, orders) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET orders = orders + 1").bind(day),
      this.db.prepare(`UPDATE demo_accounts SET cash_micros = cash_micros + ?, shares_micros = shares_micros + ?, cost_micros = cost_micros + ?, orders_count = orders_count + 1, last_order_id = ?, updated_at = ? WHERE subject = ? AND ${guard} AND (SELECT orders FROM demo_daily WHERE day = ?) <= ?`)
        .bind(bindable(cashDelta), bindable(sharesDelta), bindable(costDelta), input.id, at, subject, ...guardValues, day, DEMO_DAILY_ORDER_CAP),
      this.db.prepare("INSERT INTO demo_orders (id, subject, side, usd_micros, shares_micros, nav_micros, nav_effective_at, nav_holdings_hash, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM demo_accounts WHERE subject = ? AND last_order_id = ?)")
        .bind(input.id, subject, input.side, bindable(usd), bindable(shares), bindable(nav.navMicros), nav.effectiveAt, nav.holdingsHash, at, subject, input.id),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (/UNIQUE constraint failed: demo_orders\.id/i.test(error instanceof Error ? error.message : "")) {
        const replay = await this.order(subject, input.id);
        if (replay) return { order: replay, account: await this.account(subject), replayed: true };
        throw new DemoOrderError("That order id is already in use.", 409, "order_id_taken");
      }
      throw error;
    }
    const order = await this.order(subject, input.id);
    if (!order) {
      const attempts = await this.db.prepare("SELECT orders FROM demo_daily WHERE day = ?").bind(day).first<{ orders: number }>();
      if ((attempts?.orders ?? 0) > DEMO_DAILY_ORDER_CAP) throw new DemoOrderError("The demo has reached today's order limit. Try again after 00:00 UTC.", 429, "daily_limit");
      throw new DemoOrderError("Your demo account changed while this order was placed. Review it and try again.", 409, "account_changed");
    }
    return { order, account: await this.account(subject), replayed: false };
  }

  /** The fund across all demo accounts, as totals only. */
  async fund(now: Date): Promise<DemoFund> {
    const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const [totals, daily, flows] = await Promise.all([
      this.db.prepare("SELECT COALESCE(SUM(shares_micros), 0) AS shares, COALESCE(SUM(CASE WHEN shares_micros > 0 THEN 1 ELSE 0 END), 0) AS investors FROM demo_accounts").first<{ shares: number; investors: number }>(),
      this.db.prepare("SELECT orders FROM demo_daily WHERE day = ?").bind(now.toISOString().slice(0, 10)).first<{ orders: number }>(),
      this.db.prepare("SELECT COALESCE(SUM(CASE WHEN side = 'subscribe' THEN usd_micros ELSE 0 END), 0) AS invested, COALESCE(SUM(CASE WHEN side = 'redeem' THEN usd_micros ELSE 0 END), 0) AS redeemed, COUNT(*) AS orders FROM demo_orders WHERE created_at >= ?").bind(since).first<{ invested: number; redeemed: number; orders: number }>(),
    ]);
    return {
      sharesOutstandingMicros: String(totals?.shares ?? 0),
      investors: Number(totals?.investors ?? 0),
      ordersToday: Number(daily?.orders ?? 0),
      last24h: { investedMicros: String(flows?.invested ?? 0), redeemedMicros: String(flows?.redeemed ?? 0), orders: Number(flows?.orders ?? 0) },
    };
  }

  /** Starts the account again with $10,000 demo dollars and no history. */
  async reset(subject: string, now: Date): Promise<DemoAccount> {
    const at = now.toISOString();
    await this.db.batch([
      this.db.prepare("DELETE FROM demo_orders WHERE subject = ?").bind(subject),
      this.db.prepare("UPDATE demo_accounts SET cash_micros = ?, shares_micros = 0, cost_micros = 0, orders_count = 0, last_order_id = NULL, updated_at = ? WHERE subject = ?").bind(bindable(DEMO_START_CASH_MICROS), at, subject),
    ]);
    return this.account(subject);
  }
}
