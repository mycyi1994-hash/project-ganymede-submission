export type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
export type FundDb = { prepare(query: string): Statement; batch(statements: Statement[]): Promise<unknown>; exec?(query: string): Promise<unknown> };

/** Created by the NAV cron and mutating demo routes, never by a public read. */
export const FUND_DEMO_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS demo_fund_positions (subject TEXT NOT NULL, fund_id TEXT NOT NULL, shares_micros INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0, last_order_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (subject, fund_id))",
  "CREATE TABLE IF NOT EXISTS demo_fund_orders (id TEXT PRIMARY KEY NOT NULL, subject TEXT NOT NULL, fund_id TEXT NOT NULL, side TEXT NOT NULL, usd_micros INTEGER NOT NULL, shares_micros INTEGER NOT NULL, nav_micros INTEGER NOT NULL, nav_effective_at TEXT NOT NULL, nav_holdings_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS demo_fund_orders_subject ON demo_fund_orders (subject, created_at)",
];

export async function ensureFundDemoTables(db: FundDb): Promise<void> {
  // One at a time: the index can only be prepared once its table exists.
  for (const query of FUND_DEMO_SCHEMA) await db.prepare(query).run();
}

