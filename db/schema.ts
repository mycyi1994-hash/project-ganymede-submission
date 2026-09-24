import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  ticker: text("ticker").notNull().unique(),
  name: text("name").notNull(),
  strategyStyle: text("strategy_style", { enum: ["passive", "active"] }).notNull(),
  category: text("category").notNull(),
  status: text("status", { enum: ["draft", "operational", "paused", "closed"] }).notNull().default("operational"),
  benchmark: text("benchmark").notNull(),
  expenseRatioBps: integer("expense_ratio_bps").notNull(),
  rebalanceCadence: text("rebalance_cadence").notNull(),
  baseCurrency: text("base_currency").notNull().default("KRW"),
  sharesOutstandingMicros: text("shares_outstanding_micros").notNull().default("0"),
  cashBalanceKrw: text("cash_balance_krw").notNull().default("0"),
  ...timestamps,
});

export const assets = sqliteTable("assets", {
  symbol: text("symbol").primaryKey(),
  market: text("market").notNull().unique(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  stablecoin: integer("stablecoin", { mode: "boolean" }).notNull().default(false),
  eligible: integer("eligible", { mode: "boolean" }).notNull().default(true),
  circulatingSupplyMicros: text("circulating_supply_micros").notNull(),
  custodySupported: integer("custody_supported", { mode: "boolean" }).notNull().default(true),
  listingDate: text("listing_date").notNull(),
  decimals: integer("decimals").notNull().default(8),
  ...timestamps,
});

export const strategyConfigs = sqliteTable("strategy_configs", {
  productId: text("product_id").primaryKey().references(() => products.id, { onDelete: "cascade" }),
  style: text("style", { enum: ["passive", "active"] }).notNull(),
  version: integer("version").notNull().default(1),
  maxWeightBps: integer("max_weight_bps").notNull(),
  minWeightBps: integer("min_weight_bps").notNull(),
  cashBufferBps: integer("cash_buffer_bps").notNull().default(100),
  turnoverLimitBps: integer("turnover_limit_bps").notNull().default(2500),
  minimumVolumeKrw: text("minimum_volume_krw").notNull(),
  minimumHistoryDays: integer("minimum_history_days").notNull().default(180),
  parametersJson: text("parameters_json").notNull(),
  approvedBy: text("approved_by").notNull().default("SYSTEM"),
  ...timestamps,
});

export const marketPrices = sqliteTable("market_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().references(() => assets.symbol, { onDelete: "cascade" }),
  priceKrw: text("price_krw").notNull(),
  bidKrw: text("bid_krw").notNull(),
  askKrw: text("ask_krw").notNull(),
  volume24hKrw: text("volume_24h_krw").notNull(),
  change24hBps: integer("change_24h_bps").notNull().default(0),
  source: text("source").notNull(),
  quality: text("quality", { enum: ["live", "delayed", "reference", "stale"] }).notNull(),
  asOf: text("as_of").notNull(),
}, (table) => [
  uniqueIndex("market_prices_symbol_asof_idx").on(table.symbol, table.asOf),
  index("market_prices_asof_idx").on(table.asOf),
]);

export const priceCandles = sqliteTable("price_candles", {
  symbol: text("symbol").notNull().references(() => assets.symbol, { onDelete: "cascade" }),
  candleDate: text("candle_date").notNull(),
  openKrw: text("open_krw").notNull(),
  highKrw: text("high_krw").notNull(),
  lowKrw: text("low_krw").notNull(),
  closeKrw: text("close_krw").notNull(),
  volumeKrw: text("volume_krw").notNull(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.symbol, table.candleDate] })]);

export const strategySignals = sqliteTable("strategy_signals", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull().references(() => assets.symbol, { onDelete: "cascade" }),
  momentumScoreMicros: integer("momentum_score_micros").notNull(),
  volatilityScoreMicros: integer("volatility_score_micros").notNull(),
  liquidityScoreMicros: integer("liquidity_score_micros").notNull(),
  convictionScoreMicros: integer("conviction_score_micros").notNull(),
  asOf: text("as_of").notNull(),
}, (table) => [primaryKey({ columns: [table.productId, table.symbol, table.asOf] })]);

export const targetAllocations = sqliteTable("target_allocations", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull().references(() => assets.symbol, { onDelete: "cascade" }),
  targetWeightBps: integer("target_weight_bps").notNull(),
  rationale: text("rationale").notNull(),
  effectiveAt: text("effective_at").notNull(),
  strategyVersion: integer("strategy_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.productId, table.symbol, table.effectiveAt] })]);

export const fundPositions = sqliteTable("fund_positions", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull().references(() => assets.symbol, { onDelete: "cascade" }),
  unitsAtomic: text("units_atomic").notNull().default("0"),
  costBasisKrw: text("cost_basis_krw").notNull().default("0"),
  marketValueKrw: text("market_value_krw").notNull().default("0"),
  lastPriceKrw: text("last_price_krw").notNull().default("0"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.productId, table.symbol] })]);

export const navSnapshots = sqliteTable("nav_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  navPerShareMicros: text("nav_per_share_micros").notNull(),
  netAssetValueKrw: text("net_asset_value_krw").notNull(),
  grossAssetValueKrw: text("gross_asset_value_krw").notNull(),
  liabilitiesKrw: text("liabilities_krw").notNull().default("0"),
  sharesOutstandingMicros: text("shares_outstanding_micros").notNull(),
  dailyReturnBps: integer("daily_return_bps").notNull().default(0),
  trackingErrorBps: integer("tracking_error_bps").notNull().default(0),
  quality: text("quality", { enum: ["official", "indicative", "stale", "blocked"] }).notNull(),
  holdingsHash: text("holdings_hash").notNull(),
  asOf: text("as_of").notNull(),
}, (table) => [
  uniqueIndex("nav_product_asof_idx").on(table.productId, table.asOf),
  index("nav_asof_idx").on(table.asOf),
]);

export const rebalanceRuns = sqliteTable("rebalance_runs", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  strategyStyle: text("strategy_style", { enum: ["passive", "active"] }).notNull(),
  status: text("status", { enum: ["planned", "approved", "executing", "completed", "failed", "cancelled"] }).notNull(),
  trigger: text("trigger").notNull(),
  targetJson: text("target_json").notNull(),
  turnoverBps: integer("turnover_bps").notNull().default(0),
  scheduledFor: text("scheduled_for").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
  ...timestamps,
}, (table) => [index("rebalance_product_status_idx").on(table.productId, table.status)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  rebalanceRunId: text("rebalance_run_id").references(() => rebalanceRuns.id, { onDelete: "set null" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull().references(() => assets.symbol),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  orderType: text("order_type", { enum: ["market", "limit"] }).notNull(),
  requestedNotionalKrw: text("requested_notional_krw").notNull(),
  requestedUnitsAtomic: text("requested_units_atomic"),
  limitPriceKrw: text("limit_price_krw"),
  status: text("status", { enum: ["pending", "submitted", "partially_filled", "filled", "cancelled", "rejected", "simulated"] }).notNull(),
  venue: text("venue").notNull().default("UPBIT"),
  venueOrderId: text("venue_order_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  error: text("error"),
  ...timestamps,
}, (table) => [
  index("orders_product_status_idx").on(table.productId, table.status),
  index("orders_rebalance_idx").on(table.rebalanceRunId),
]);

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  venueTradeId: text("venue_trade_id").notNull().unique(),
  priceKrw: text("price_krw").notNull(),
  unitsAtomic: text("units_atomic").notNull(),
  feeKrw: text("fee_krw").notNull().default("0"),
  executedAt: text("executed_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("fills_order_idx").on(table.orderId)]);

export const investors = sqliteTable("investors", {
  id: text("id").primaryKey(),
  externalSubject: text("external_subject").notNull().unique(),
  email: text("email"),
  walletAddress: text("wallet_address"),
  kycStatus: text("kyc_status", { enum: ["unverified", "pending", "verified", "expired", "blocked"] }).notNull().default("unverified"),
  investorClass: text("investor_class").notNull().default("retail"),
  ...timestamps,
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  amountKrw: text("amount_krw").notNull(),
  expectedSharesMicros: text("expected_shares_micros").notNull(),
  issuedSharesMicros: text("issued_shares_micros").notNull().default("0"),
  status: text("status", { enum: ["requested", "kyc_review", "funding", "executing", "settled", "rejected", "cancelled"] }).notNull(),
  clientReference: text("client_reference").notNull().unique(),
  giwaTxHash: text("giwa_tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
});

export const redemptions = sqliteTable("redemptions", {
  id: text("id").primaryKey(),
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  requestedSharesMicros: text("requested_shares_micros").notNull(),
  proceedsKrw: text("proceeds_krw").notNull().default("0"),
  status: text("status", { enum: ["requested", "locked", "executing", "settled", "rejected", "cancelled"] }).notNull(),
  clientReference: text("client_reference").notNull().unique(),
  giwaTxHash: text("giwa_tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
});

export const investorPositions = sqliteTable("investor_positions", {
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  sharesMicros: text("shares_micros").notNull().default("0"),
  costBasisKrw: text("cost_basis_krw").notNull().default("0"),
  realizedPnlKrw: text("realized_pnl_krw").notNull().default("0"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.investorId, table.productId] })]);

export const giwaSettlements = sqliteTable("giwa_settlements", {
  id: text("id").primaryKey(),
  entityType: text("entity_type", { enum: ["nav", "subscription", "redemption", "rebalance"] }).notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status", { enum: ["queued", "submitted", "confirmed", "failed", "simulated"] }).notNull(),
  txHash: text("tx_hash"),
  blockNumber: text("block_number"),
  error: text("error"),
  ...timestamps,
}, (table) => [uniqueIndex("giwa_entity_action_idx").on(table.entityType, table.entityId, table.action)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  actor: text("actor").notNull(),
  payloadJson: text("payload_json").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("audit_entity_idx").on(table.entityType, table.entityId),
  index("audit_created_idx").on(table.createdAt),
]);

export const engineState = sqliteTable("engine_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workerLeases = sqliteTable("worker_leases", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
