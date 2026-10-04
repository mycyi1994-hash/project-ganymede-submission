/**
 * Demo-balance investing in the five funds other than USTX (lib/funds/catalog.ts). The cash is the
 * same demo balance USTX uses (demo_accounts.cash_micros); each fund's shares and cost sit in their
 * own row, and its orders in their own table, so the USTX ledger (lib/demo/ledger.ts) is unchanged.
 * No real money and nothing issued on chain: orders fill at the NAV recorded on X Layer.
 */
import { DEMO_DAILY_ORDER_CAP, DEMO_MIN_ORDER_MICROS, DEMO_ORDER_HISTORY, DEMO_START_CASH_MICROS, DemoOrderError, costRemoved, sharesForUsd, usdForShares, type DemoSide, type ExecutableNav } from "../demo/ledger";

import { DemoLedger } from "../demo/ledger";
import type { FundDb, Statement } from "./schema";
export { ensureFundDemoTables, FUND_DEMO_SCHEMA, type FundDb } from "./schema";

export type FundPosition = { fundId: string; sharesMicros: string; costMicros: string };
export type FundOrder = { id: string; fundId: string; side: DemoSide; usdMicros: string; sharesMicros: string; navMicros: string; navEffectiveAt: string; navHoldingsHash: string; createdAt: string };
type OrderRow = { id: string; fund_id: string; side: DemoSide; usd_micros: number; shares_micros: number; nav_micros: number; nav_effective_at: string; nav_holdings_hash: string; created_at: string };

const toOrder = (row: OrderRow): FundOrder => ({ id: row.id, fundId: row.fund_id, side: row.side, usdMicros: String(row.usd_micros), sharesMicros: String(row.shares_micros), navMicros: String(row.nav_micros), navEffectiveAt: row.nav_effective_at, navHoldingsHash: row.nav_holdings_hash, createdAt: row.created_at });
const ORDER_COLUMNS = "id, fund_id, side, usd_micros, shares_micros, nav_micros, nav_effective_at, nav_holdings_hash, created_at";

function bindable(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new DemoOrderError("The amount is too large.");
  return number;
}

/** A missing table reads as empty: the tables appear with the first NAV cycle after deployment. */
async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try { return await read(); } catch (error) {
    if (/no such table/i.test(error instanceof Error ? error.message : "")) return empty;
    throw error;
  }
}

export class FundDemoLedger {
  private readonly db: FundDb;
  constructor(db: FundDb) { this.db = db; }

  async cash(subject: string): Promise<bigint> {
    const row = await this.db.prepare("SELECT cash_micros FROM demo_accounts WHERE subject = ?").bind(subject).first<{ cash_micros: number }>();
    return row ? BigInt(row.cash_micros) : DEMO_START_CASH_MICROS;
  }

  positions(subject: string): Promise<FundPosition[]> {
    return orEmpty(async () => (await this.db.prepare("SELECT fund_id, shares_micros, cost_micros FROM demo_fund_positions WHERE subject = ? AND shares_micros > 0 ORDER BY fund_id").bind(subject).all<{ fund_id: string; shares_micros: number; cost_micros: number }>()).results
      .map((row) => ({ fundId: row.fund_id, sharesMicros: String(row.shares_micros), costMicros: String(row.cost_micros) })), []);
  }

  orders(subject: string, fundId?: string, limit = DEMO_ORDER_HISTORY): Promise<FundOrder[]> {
    return orEmpty(async () => (fundId
      ? await this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM demo_fund_orders WHERE subject = ? AND fund_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(subject, fundId, limit).all<OrderRow>()
      : await this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM demo_fund_orders WHERE subject = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(subject, limit).all<OrderRow>()).results.map(toOrder), []);
  }

  async order(subject: string, id: string): Promise<FundOrder | null> {
    return orEmpty(async () => {
      const row = await this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM demo_fund_orders WHERE subject = ? AND id = ?`).bind(subject, id).first<OrderRow>();
      return row ? toOrder(row) : null;
    }, null);
  }

  /** Shares of one fund held across all demo balances: recorded beside its NAV. */
  sharesOutstanding(fundId: string): Promise<string> {
    return orEmpty(async () => String((await this.db.prepare("SELECT COALESCE(SUM(shares_micros), 0) AS shares FROM demo_fund_positions WHERE fund_id = ?").bind(fundId).first<{ shares: number }>())?.shares ?? 0), "0");
  }

  /** Holders and shares of one fund, as totals only. */
  totals(fundId: string): Promise<{ sharesMicros: string; investors: number }> {
    return orEmpty(async () => {
      const row = await this.db.prepare("SELECT COALESCE(SUM(shares_micros), 0) AS shares, COALESCE(SUM(CASE WHEN shares_micros > 0 THEN 1 ELSE 0 END), 0) AS investors FROM demo_fund_positions WHERE fund_id = ?").bind(fundId).first<{ shares: number; investors: number }>();
      return { sharesMicros: String(row?.shares ?? 0), investors: Number(row?.investors ?? 0) };
    }, { sharesMicros: "0", investors: 0 });
  }

  /**
   * Fills one order in a single transaction, like the USTX ledger: the side that pays is updated
   * under its condition and marked with the order id, and the other side and the order row are
   * written only if that mark is there. A retry with the same id replays the stored order.
   */
  async place(subject: string, fundId: string, input: { id: string; side: DemoSide; usdMicros?: bigint; sharesMicros?: bigint }, nav: ExecutableNav, now: Date): Promise<{ order: FundOrder; replayed: boolean }> {
    const existing = await this.order(subject, input.id);
    if (existing) {
      if (existing.fundId !== fundId) throw new DemoOrderError("That order id is already in use.", 409, "order_id_taken");
      return { order: existing, replayed: true };
    }
    const at = now.toISOString();
    const day = at.slice(0, 10);
    const statements: Statement[] = [
      this.db.prepare("INSERT OR IGNORE INTO demo_accounts (subject, cash_micros, shares_micros, cost_micros, orders_count, last_order_id, created_at, updated_at) VALUES (?, ?, 0, 0, 0, NULL, ?, ?)").bind(subject, bindable(DEMO_START_CASH_MICROS), at, at),
      this.db.prepare("INSERT INTO demo_daily (day, orders) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET orders = orders + 1").bind(day),
      this.db.prepare("INSERT OR IGNORE INTO demo_fund_positions (subject, fund_id, shares_micros, cost_micros, last_order_id, updated_at) VALUES (?, ?, 0, 0, NULL, ?)").bind(subject, fundId, at),
    ];
    const capped = "(SELECT orders FROM demo_daily WHERE day = ?) <= ?";
    let usd: bigint, shares: bigint, mark: string;
    if (input.side === "subscribe") {
      usd = input.usdMicros ?? 0n;
      if (usd < DEMO_MIN_ORDER_MICROS) throw new DemoOrderError("The minimum order is $10.");
      if (usd > await this.cash(subject)) throw new DemoOrderError("That is more than your demo cash.", 409, "insufficient_cash");
      shares = sharesForUsd(usd, nav.navMicros);
      if (shares <= 0n) throw new DemoOrderError("That amount buys no shares.");
      statements.push(
        this.db.prepare(`UPDATE demo_accounts SET cash_micros = cash_micros - ?, orders_count = orders_count + 1, last_order_id = ?, updated_at = ? WHERE subject = ? AND cash_micros >= ? AND ${capped}`)
          .bind(bindable(usd), input.id, at, subject, bindable(usd), day, DEMO_DAILY_ORDER_CAP),
        this.db.prepare("UPDATE demo_fund_positions SET shares_micros = shares_micros + ?, cost_micros = cost_micros + ?, last_order_id = ?, updated_at = ? WHERE subject = ? AND fund_id = ? AND EXISTS (SELECT 1 FROM demo_accounts WHERE subject = ? AND last_order_id = ?)")
          .bind(bindable(shares), bindable(usd), input.id, at, subject, fundId, subject, input.id),
      );
      mark = "SELECT 1 FROM demo_accounts WHERE subject = ? AND last_order_id = ?";
    } else {
      shares = input.sharesMicros ?? 0n;
      const position = await this.db.prepare("SELECT shares_micros, cost_micros FROM demo_fund_positions WHERE subject = ? AND fund_id = ?").bind(subject, fundId).first<{ shares_micros: number; cost_micros: number }>().catch(() => null);
      const held = BigInt(position?.shares_micros ?? 0);
      const cost = BigInt(position?.cost_micros ?? 0);
      if (shares <= 0n) throw new DemoOrderError("Enter the number of shares to redeem.");
      if (shares > held) throw new DemoOrderError("That is more than the shares you hold.", 409, "insufficient_shares");
      usd = usdForShares(shares, nav.navMicros);
      if (usd <= 0n) throw new DemoOrderError("That many shares is worth less than one micro-dollar.");
      statements.push(
        // The cost removed depends on the holding read above, so the update requires it unchanged.
        this.db.prepare(`UPDATE demo_fund_positions SET shares_micros = shares_micros - ?, cost_micros = cost_micros - ?, last_order_id = ?, updated_at = ? WHERE subject = ? AND fund_id = ? AND shares_micros = ? AND cost_micros = ? AND ${capped}`)
          .bind(bindable(shares), bindable(costRemoved(cost, held, shares)), input.id, at, subject, fundId, bindable(held), bindable(cost), day, DEMO_DAILY_ORDER_CAP),
        this.db.prepare("UPDATE demo_accounts SET cash_micros = cash_micros + ?, orders_count = orders_count + 1, updated_at = ? WHERE subject = ? AND EXISTS (SELECT 1 FROM demo_fund_positions WHERE subject = ? AND fund_id = ? AND last_order_id = ?)")
          .bind(bindable(usd), at, subject, subject, fundId, input.id),
      );
      mark = "SELECT 1 FROM demo_fund_positions WHERE subject = ? AND last_order_id = ?";
    }
    statements.push(this.db.prepare(`INSERT INTO demo_fund_orders (${ORDER_COLUMNS}, subject) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${mark})`)
      .bind(input.id, fundId, input.side, bindable(usd), bindable(shares), bindable(nav.navMicros), nav.effectiveAt, nav.holdingsHash, at, subject, subject, input.id));
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (/UNIQUE constraint failed: demo_fund_orders\.id/i.test(error instanceof Error ? error.message : "")) {
        const replay = await this.order(subject, input.id);
        if (replay) return { order: replay, replayed: true };
      }
      throw error;
    }
    const order = await this.order(subject, input.id);
    if (!order) {
      const attempts = await this.db.prepare("SELECT orders FROM demo_daily WHERE day = ?").bind(day).first<{ orders: number }>();
      if ((attempts?.orders ?? 0) > DEMO_DAILY_ORDER_CAP) throw new DemoOrderError("The demo has reached today's order limit. Try again after 00:00 UTC.", 429, "daily_limit");
      throw new DemoOrderError("Your demo balance changed while this order was placed. Review it and try again.", 409, "account_changed");
    }
    return { order, replayed: false };
  }

  /** Starts the shared demo account again, clearing every fund in the same transaction. */
  async reset(subject: string, now = new Date()): Promise<void> {
    await new DemoLedger(this.db as unknown as D1Database).reset(subject, now);
  }
}
