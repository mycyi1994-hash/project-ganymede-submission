import { ASSET_UNIVERSE, PRODUCT_DEFINITIONS } from "./seed";
import { asBigInt, krwForShares, newId, sha256Hex, sharesForSubscription, stableJson, unitsToMarketValueKrw } from "./fixed";
import type {
  AssetDefinition,
  DailyCandle,
  EngineCycleResult,
  ExecutionResult,
  MarketTick,
  OrderIntent,
  ProductDefinition,
  StrategyResult,
} from "./types";
import type { SettlementRequest, SettlementResult } from "./settlement";

type ProductRow = {
  id: string;
  slug: string;
  ticker: string;
  name: string;
  strategy_style: "passive" | "active";
  status: string;
  shares_outstanding_micros: string;
  cash_balance_krw: string;
};

type PositionRow = {
  product_id: string;
  symbol: string;
  units_atomic: string;
  cost_basis_krw: string;
  market_value_krw: string;
  last_price_krw: string;
};

type NavRow = {
  product_id: string;
  nav_per_share_micros: string;
  net_asset_value_krw: string;
  shares_outstanding_micros: string;
  as_of: string;
  quality: string;
};

type SubscriptionRow = {
  id: string;
  investor_id: string;
  product_id: string;
  amount_krw: string;
  expected_shares_micros: string;
  status: string;
  created_at: string;
  kyc_status: string;
  wallet_address: string | null;
};

type RedemptionRow = {
  id: string;
  investor_id: string;
  product_id: string;
  requested_shares_micros: string;
  status: string;
  created_at: string;
  kyc_status: string;
  wallet_address: string | null;
};

const INITIAL_FUND_CASH_KRW = "100000000000";
const INITIAL_SHARES_MICROS = "100000000000000";
const INITIAL_NAV_PER_SHARE_MICROS = 1_000_000_000n;

export const MIN_SUBSCRIPTION_KRW = 100_000n;
export const MAX_SUBSCRIPTION_KRW = 1_000_000_000n;
export const MAX_OPEN_REQUESTS = 10;
/** Ledger values stay well inside SQLite's signed 64-bit INTEGER, which the CAST arithmetic uses. */
export const LEDGER_LIMIT = 2n ** 62n;
const PENDING_SUBSCRIPTION_SQL = "('kyc_review','funding','executing')";
const PENDING_REDEMPTION_SQL = "('requested','locked','executing')";
/** Investor flows are priced only from NAVs calculated on live market data. */
const PRICING_QUALITY_SQL = "('official','indicative')";

/** A request the caller can fix; routes answer it with HTTP 400 and its message. */
export class LedgerRequestError extends Error {}

function changedRows(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
}

/**
 * Paper mode, and any flow with no on-chain step (null) or no configured relayer
 * ("simulated"), settles on the ledger. Otherwise only a confirmed transaction
 * settles, only a definitive rejection rejects, and anything else is retried.
 */
function settlementDecision(settlement: SettlementResult | null, paperMode: boolean): "settle" | "reject" | "wait" {
  if (paperMode || !settlement || settlement.status === "confirmed" || settlement.status === "simulated") return "settle";
  if (settlement.status === "failed") return "reject";
  return "wait";
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value && value.includes("@") ? value : null;
}

function validateWallet(wallet: string | null | undefined): string | null {
  const value = wallet?.trim();
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
}

export class EngineRepository {
  readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async seed(): Promise<void> {
    const version = await sha256Hex(stableJson({ schema: 1, products: PRODUCT_DEFINITIONS, assets: ASSET_UNIVERSE }));
    if ((await this.getState("seed:version"))?.value === version) return;
    const statements: D1PreparedStatement[] = [];
    for (const product of PRODUCT_DEFINITIONS) {
      statements.push(this.db.prepare(`
        INSERT INTO products (
          id, slug, ticker, name, strategy_style, category, status, benchmark,
          expense_ratio_bps, rebalance_cadence, base_currency,
          shares_outstanding_micros, cash_balance_krw
        ) VALUES (?, ?, ?, ?, ?, ?, 'operational', ?, ?, ?, 'KRW', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          slug = excluded.slug,
          ticker = excluded.ticker,
          name = excluded.name,
          strategy_style = excluded.strategy_style,
          category = excluded.category,
          benchmark = excluded.benchmark,
          expense_ratio_bps = excluded.expense_ratio_bps,
          rebalance_cadence = excluded.rebalance_cadence,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        product.id, product.slug, product.ticker, product.name, product.strategyStyle, product.category,
        product.benchmark, product.expenseRatioBps, product.rebalanceCadence, INITIAL_SHARES_MICROS, INITIAL_FUND_CASH_KRW,
      ));
      statements.push(this.db.prepare(`
        INSERT INTO strategy_configs (
          product_id, style, version, max_weight_bps, min_weight_bps,
          cash_buffer_bps, turnover_limit_bps, minimum_volume_krw,
          minimum_history_days, parameters_json, approved_by
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'INVESTMENT_COMMITTEE')
        ON CONFLICT(product_id) DO UPDATE SET
          style = excluded.style,
          max_weight_bps = excluded.max_weight_bps,
          min_weight_bps = excluded.min_weight_bps,
          cash_buffer_bps = excluded.cash_buffer_bps,
          turnover_limit_bps = excluded.turnover_limit_bps,
          minimum_volume_krw = excluded.minimum_volume_krw,
          minimum_history_days = excluded.minimum_history_days,
          parameters_json = excluded.parameters_json,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        product.id, product.strategyStyle, product.maxWeightBps, product.minWeightBps,
        product.cashBufferBps, product.turnoverLimitBps, product.minimumVolumeKrw,
        product.minimumHistoryDays, JSON.stringify(product.parameters),
      ));
    }
    for (const asset of ASSET_UNIVERSE) {
      statements.push(this.db.prepare(`
        INSERT INTO assets (
          symbol, market, name, asset_class, stablecoin, eligible,
          circulating_supply_micros, custody_supported, listing_date, decimals
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          market = excluded.market,
          name = excluded.name,
          asset_class = excluded.asset_class,
          stablecoin = excluded.stablecoin,
          circulating_supply_micros = excluded.circulating_supply_micros,
          custody_supported = excluded.custody_supported,
          listing_date = excluded.listing_date,
          decimals = excluded.decimals,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        asset.symbol, asset.market, asset.name, asset.assetClass, asset.stablecoin ? 1 : 0,
        asset.circulatingSupplyMicros, asset.custodySupported ? 1 : 0, asset.listingDate, asset.decimals,
      ));
      for (const product of PRODUCT_DEFINITIONS) {
        statements.push(this.db.prepare(`
          INSERT INTO fund_positions (product_id, symbol, units_atomic, cost_basis_krw, market_value_krw, last_price_krw)
          VALUES (?, ?, '0', '0', '0', '0')
          ON CONFLICT(product_id, symbol) DO NOTHING
        `).bind(product.id, asset.symbol));
      }
    }
    for (let index = 0; index < statements.length; index += 75) await this.db.batch(statements.slice(index, index + 75));
    // Written only after every batch succeeds, so an interrupted seed is retryable.
    await this.setState("seed:version", version);
  }

  async acquireLease(name: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
    await this.db.prepare(`
      INSERT INTO worker_leases (name, owner, expires_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP
      WHERE worker_leases.expires_at < ? OR worker_leases.owner = ?
    `).bind(name, owner, expires, now.toISOString(), owner).run();
    const row = await this.db.prepare("SELECT owner FROM worker_leases WHERE name = ?").bind(name).first<{ owner: string }>();
    return row?.owner === owner;
  }

  async cycleIsDue(intervalSeconds: number, now = new Date()): Promise<boolean> {
    const row = await this.db.prepare("SELECT updated_at FROM engine_state WHERE key = 'last_cycle'").first<{ updated_at: string }>();
    if (!row?.updated_at) return true;
    const updatedAt = new Date(row.updated_at.endsWith("Z") ? row.updated_at : `${row.updated_at.replace(" ", "T")}Z`);
    return !Number.isFinite(updatedAt.getTime()) || now.getTime() - updatedAt.getTime() >= intervalSeconds * 1_000;
  }

  async releaseLease(name: string, owner: string): Promise<void> {
    await this.db.prepare("DELETE FROM worker_leases WHERE name = ? AND owner = ?").bind(name, owner).run();
  }

  async saveMarketSnapshot(ticks: MarketTick[]): Promise<void> {
    const statements = ticks.map((tick) => this.db.prepare(`
      INSERT OR IGNORE INTO market_prices (
        symbol, price_krw, bid_krw, ask_krw, volume_24h_krw,
        change_24h_bps, source, quality, as_of
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tick.symbol, Math.round(tick.priceKrw).toString(), Math.round(tick.bidKrw).toString(),
      Math.round(tick.askKrw).toString(), Math.round(tick.volume24hKrw).toString(),
      tick.change24hBps, tick.source, tick.quality, tick.asOf,
    ));
    if (statements.length) await this.db.batch(statements);
    await this.db.prepare("DELETE FROM market_prices WHERE as_of < datetime('now', '-14 days')").run();
  }

  async saveCandles(candlesBySymbol: Map<string, DailyCandle[]>): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (const candles of candlesBySymbol.values()) {
      for (const candle of candles.slice(-7)) {
        statements.push(this.db.prepare(`
          INSERT INTO price_candles (symbol, candle_date, open_krw, high_krw, low_krw, close_krw, volume_krw, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol, candle_date) DO UPDATE SET
            open_krw = excluded.open_krw,
            high_krw = excluded.high_krw,
            low_krw = excluded.low_krw,
            close_krw = excluded.close_krw,
            volume_krw = excluded.volume_krw,
            source = excluded.source
          WHERE price_candles.open_krw != excluded.open_krw
             OR price_candles.high_krw != excluded.high_krw
             OR price_candles.low_krw != excluded.low_krw
             OR price_candles.close_krw != excluded.close_krw
             OR price_candles.volume_krw != excluded.volume_krw
             OR price_candles.source != excluded.source
        `).bind(candle.symbol, candle.candleDate, candle.openKrw.toString(), candle.highKrw.toString(), candle.lowKrw.toString(), candle.closeKrw.toString(), candle.volumeKrw.toString(), candle.source));
      }
    }
    for (let index = 0; index < statements.length; index += 75) await this.db.batch(statements.slice(index, index + 75));
  }

  async getProduct(productId: string): Promise<ProductRow | null> {
    return await this.db.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<ProductRow>();
  }

  async listProducts(): Promise<ProductRow[]> {
    return (await this.db.prepare("SELECT * FROM products ORDER BY strategy_style, id").all<ProductRow>()).results;
  }

  async getPositions(productId: string): Promise<PositionRow[]> {
    return (await this.db.prepare("SELECT * FROM fund_positions WHERE product_id = ? ORDER BY symbol").bind(productId).all<PositionRow>()).results;
  }

  /** Weights of the whole fund, cash included, on the same basis as the strategy's targets. */
  async currentWeights(productId: string, ticks: Map<string, MarketTick>): Promise<Map<string, number>> {
    const positions = await this.getPositions(productId);
    const values = new Map<string, bigint>();
    const product = await this.getProduct(productId);
    let total = product ? asBigInt(product.cash_balance_krw) : 0n;
    for (const position of positions) {
      const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === position.symbol);
      const tick = ticks.get(position.symbol);
      if (!asset || !tick) continue;
      const value = unitsToMarketValueKrw(asBigInt(position.units_atomic), BigInt(Math.round(tick.priceKrw)), asset.decimals);
      values.set(position.symbol, value);
      total += value;
    }
    const weights = new Map<string, number>();
    for (const [symbol, value] of values) weights.set(symbol, total > 0n ? Number(value * 10_000n / total) : 0);
    return weights;
  }

  /** A rebalance whose orders were sent but not all filled (live venues fill asynchronously). */
  async hasOpenRebalance(productId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT 1 AS open FROM rebalance_runs WHERE product_id = ? AND status IN ('approved','executing') LIMIT 1").bind(productId).first<{ open: number }>();
    return Boolean(row);
  }

  async latestCompletedRebalance(productId: string): Promise<string | null> {
    const row = await this.db.prepare(`
      SELECT completed_at FROM rebalance_runs
      WHERE product_id = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `).bind(productId).first<{ completed_at: string }>();
    return row?.completed_at ?? null;
  }

  async saveStrategy(result: StrategyResult, version = 1): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (const target of result.targets) {
      statements.push(this.db.prepare(`
        INSERT INTO strategy_signals (
          product_id, symbol, momentum_score_micros, volatility_score_micros,
          liquidity_score_micros, conviction_score_micros, as_of
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        result.productId, target.symbol,
        Math.round(target.momentum90 * 1_000_000),
        Math.round(target.annualizedVolatility * 1_000_000),
        Math.round(target.liquidityScore * 1_000_000),
        Math.round(target.convictionScore * 1_000_000),
        result.asOf,
      ));
      statements.push(this.db.prepare(`
        INSERT INTO target_allocations (
          product_id, symbol, target_weight_bps, rationale,
          effective_at, strategy_version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(result.productId, target.symbol, target.weightBps, target.rationale, result.asOf, version));
    }
    if (statements.length) await this.db.batch(statements);
  }

  async createRebalance(product: ProductDefinition, result: StrategyResult, trigger: string): Promise<string> {
    const id = newId("rebalance");
    const status = result.blocked ? "planned" : "approved";
    await this.db.prepare(`
      INSERT INTO rebalance_runs (
        id, product_id, strategy_style, status, trigger, target_json,
        turnover_bps, scheduled_for, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, product.id, product.strategyStyle, status, trigger, JSON.stringify(result.targets), result.turnoverBps, result.asOf, result.blocked ? null : result.asOf).run();
    await this.audit("rebalance.created", "rebalance", id, "ENGINE", { productId: product.id, status, blockReason: result.blockReason, turnoverBps: result.turnoverBps });
    return id;
  }

  async markRebalance(id: string, status: "executing" | "completed" | "failed", error: string | null = null): Promise<void> {
    await this.db.prepare(`
      UPDATE rebalance_runs SET status = ?, error = ?,
        started_at = CASE WHEN ? = 'executing' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, error, status, status, id).run();
  }

  async saveExecution(intent: OrderIntent, result: ExecutionResult, tick: MarketTick, decimals: number): Promise<void> {
    const orderStatus = result.status === "simulated" ? "simulated" : result.status;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [this.db.prepare(`
      INSERT INTO orders (
        id, rebalance_run_id, product_id, symbol, side, order_type,
        requested_notional_krw, requested_units_atomic, limit_price_krw,
        status, venue, venue_order_id, idempotency_key, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPBIT', ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).bind(
      intent.id, intent.rebalanceRunId, intent.productId, intent.symbol, intent.side, intent.orderType,
      intent.requestedNotionalKrw.toString(), intent.requestedUnitsAtomic?.toString() ?? null,
      intent.limitPriceKrw?.toString() ?? null, orderStatus, result.venueOrderId,
      intent.idempotencyKey, result.error, now, now,
    )];

    if ((result.status === "simulated" || result.status === "filled") && result.executedPriceKrw && result.executedUnitsAtomic) {
      const fillId = newId("fill");
      const signedUnits = intent.side === "buy" ? result.executedUnitsAtomic : -result.executedUnitsAtomic;
      const marketValue = unitsToMarketValueKrw(result.executedUnitsAtomic, result.executedPriceKrw, decimals);
      const cashDelta = intent.side === "buy" ? -(marketValue + result.feeKrw) : marketValue - result.feeKrw;
      statements.push(this.db.prepare(`
        INSERT INTO fills (id, order_id, venue_trade_id, price_krw, units_atomic, fee_krw, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(fillId, intent.id, `${result.venueOrderId}:0`, result.executedPriceKrw.toString(), result.executedUnitsAtomic.toString(), result.feeKrw.toString(), now));
      statements.push(this.db.prepare(`
        UPDATE fund_positions SET
          units_atomic = CAST(CASE WHEN CAST(units_atomic AS INTEGER) + CAST(? AS INTEGER) < 0 THEN 0 ELSE CAST(units_atomic AS INTEGER) + CAST(? AS INTEGER) END AS TEXT),
          cost_basis_krw = CAST(CASE WHEN ? = 'buy' THEN CAST(cost_basis_krw AS INTEGER) + CAST(? AS INTEGER) ELSE MAX(0, CAST(cost_basis_krw AS INTEGER) - CAST(? AS INTEGER)) END AS TEXT),
          market_value_krw = CAST(MAX(0, (CAST(units_atomic AS INTEGER) + CAST(? AS INTEGER)) * CAST(? AS INTEGER) / CAST(? AS INTEGER)) AS TEXT),
          last_price_krw = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND symbol = ?
      `).bind(
        signedUnits.toString(), signedUnits.toString(), intent.side, marketValue.toString(), marketValue.toString(),
        signedUnits.toString(), result.executedPriceKrw.toString(), (10n ** BigInt(decimals)).toString(),
        result.executedPriceKrw.toString(), intent.productId, intent.symbol,
      ));
      statements.push(this.db.prepare(`
        UPDATE products SET cash_balance_krw = CAST(MAX(0, CAST(cash_balance_krw AS INTEGER) + CAST(? AS INTEGER)) AS TEXT), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(cashDelta.toString(), intent.productId));
    }
    await this.db.batch(statements);
    await this.audit("order.executed", "order", intent.id, "ENGINE", { intent: { ...intent, requestedNotionalKrw: intent.requestedNotionalKrw.toString(), requestedUnitsAtomic: intent.requestedUnitsAtomic?.toString() }, result: { ...result, executedPriceKrw: result.executedPriceKrw?.toString(), executedUnitsAtomic: result.executedUnitsAtomic?.toString(), feeKrw: result.feeKrw.toString() }, referencePrice: tick.priceKrw });
  }

  async calculateAndSaveNav(productId: string, ticks: Map<string, MarketTick>, quality: "official" | "indicative" | "stale" | "blocked" = "indicative"): Promise<{ navPerShareMicros: bigint; netAssetValueKrw: bigint; sharesOutstandingMicros: bigint; holdingsHash: string; asOf: string }> {
    const product = await this.getProduct(productId);
    if (!product) throw new Error(`Unknown product ${productId}`);
    const positions = await this.getPositions(productId);
    let gross = 0n;
    const holdingState: Array<{ symbol: string; unitsAtomic: string; priceKrw: number; valueKrw: string }> = [];
    const updates: D1PreparedStatement[] = [];
    for (const position of positions) {
      const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === position.symbol);
      const tick = ticks.get(position.symbol);
      if (!asset || !tick) continue;
      const value = unitsToMarketValueKrw(asBigInt(position.units_atomic), BigInt(Math.round(tick.priceKrw)), asset.decimals);
      gross += value;
      holdingState.push({ symbol: position.symbol, unitsAtomic: position.units_atomic, priceKrw: Math.round(tick.priceKrw), valueKrw: value.toString() });
      updates.push(this.db.prepare("UPDATE fund_positions SET market_value_krw = ?, last_price_krw = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND symbol = ?").bind(value.toString(), Math.round(tick.priceKrw).toString(), productId, position.symbol));
    }
    if (updates.length) await this.db.batch(updates);
    const cash = asBigInt(product.cash_balance_krw);
    const net = gross + cash;
    const shares = asBigInt(product.shares_outstanding_micros);
    const navPerShareMicros = shares > 0n ? net * 1_000_000n * 1_000_000n / shares : INITIAL_NAV_PER_SHARE_MICROS;
    const holdingsHash = await sha256Hex(stableJson({ productId, cash: cash.toString(), holdings: holdingState.sort((a, b) => a.symbol.localeCompare(b.symbol)) }));
    const previous = await this.latestNav(productId);
    const dailyReturnBps = previous && asBigInt(previous.nav_per_share_micros) > 0n
      ? Number((navPerShareMicros - asBigInt(previous.nav_per_share_micros)) * 10_000n / asBigInt(previous.nav_per_share_micros))
      : 0;
    const asOf = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO nav_snapshots (
        product_id, nav_per_share_micros, net_asset_value_krw, gross_asset_value_krw,
        liabilities_krw, shares_outstanding_micros, daily_return_bps,
        tracking_error_bps, quality, holdings_hash, as_of
      ) VALUES (?, ?, ?, ?, '0', ?, ?, 0, ?, ?, ?)
    `).bind(productId, navPerShareMicros.toString(), net.toString(), gross.toString(), shares.toString(), dailyReturnBps, quality, holdingsHash, asOf).run();
    return { navPerShareMicros, netAssetValueKrw: net, sharesOutstandingMicros: shares, holdingsHash, asOf };
  }

  async latestNav(productId: string): Promise<NavRow | null> {
    return await this.db.prepare("SELECT * FROM nav_snapshots WHERE product_id = ? ORDER BY as_of DESC LIMIT 1").bind(productId).first<NavRow>();
  }

  async saveSettlement(request: SettlementRequest, result: SettlementResult): Promise<void> {
    await this.db.prepare(`
      INSERT INTO giwa_settlements (
        id, entity_type, entity_id, action, payload_hash, status,
        tx_hash, block_number, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, action) DO UPDATE SET
        status = excluded.status,
        tx_hash = COALESCE(excluded.tx_hash, giwa_settlements.tx_hash),
        block_number = COALESCE(excluded.block_number, giwa_settlements.block_number),
        error = excluded.error,
        updated_at = CURRENT_TIMESTAMP
    `).bind(result.id, request.entityType, request.entityId, request.action, result.payloadHash, result.status, result.txHash, result.blockNumber, result.error).run();
  }

  async ensureInvestor(subject: string, email?: string | null, walletAddress?: string | null): Promise<{ id: string; kycStatus: string; walletAddress: string | null }> {
    const wallet = validateWallet(walletAddress);
    const existing = await this.db.prepare("SELECT id, kyc_status, wallet_address FROM investors WHERE external_subject = ?").bind(subject).first<{ id: string; kyc_status: string; wallet_address: string | null }>();
    if (existing) {
      // A request-supplied wallet is metadata, not proof of ownership. It is recorded
      // once and never replaced by a later request, so it cannot redirect a mint or burn.
      if (wallet && !existing.wallet_address) {
        await this.db.prepare("UPDATE investors SET wallet_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND wallet_address IS NULL").bind(wallet, existing.id).run();
      }
      return { id: existing.id, kycStatus: existing.kyc_status, walletAddress: existing.wallet_address ?? wallet };
    }
    await this.db.prepare(`
      INSERT INTO investors (id, external_subject, email, wallet_address, kyc_status)
      VALUES (?, ?, ?, ?, 'unverified')
      ON CONFLICT(external_subject) DO NOTHING
    `).bind(newId("investor"), subject, normalizeEmail(email), wallet).run();
    // Two first requests from one session can race; both read back the single row.
    const created = await this.db.prepare("SELECT id, kyc_status, wallet_address FROM investors WHERE external_subject = ?").bind(subject).first<{ id: string; kyc_status: string; wallet_address: string | null }>();
    if (!created) throw new Error("Investor record could not be created");
    return { id: created.id, kycStatus: created.kyc_status, walletAddress: created.wallet_address };
  }

  async setInvestorKyc(investorId: string, status: "unverified" | "pending" | "verified" | "expired" | "blocked", actor: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE investors SET kyc_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, investorId).run();
    if (!changedRows(result)) return false;
    await this.audit("investor.kyc_changed", "investor", investorId, actor, { status });
    return true;
  }

  private async openRequestCount(investorId: string): Promise<number> {
    const row = await this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM subscriptions WHERE investor_id = ? AND status IN ${PENDING_SUBSCRIPTION_SQL})
           + (SELECT COUNT(*) FROM redemptions WHERE investor_id = ? AND status IN ${PENDING_REDEMPTION_SQL}) AS n
    `).bind(investorId, investorId).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  async createSubscription(input: { subject: string; email?: string | null; walletAddress?: string | null; productId: string; amountKrw: bigint; clientReference: string }): Promise<{ id: string; status: string; expectedSharesMicros: string }> {
    if (input.amountKrw < MIN_SUBSCRIPTION_KRW) throw new LedgerRequestError("Minimum subscription is KRW 100,000");
    if (input.amountKrw > MAX_SUBSCRIPTION_KRW) throw new LedgerRequestError("Maximum paper subscription is KRW 1,000,000,000");
    const product = await this.getProduct(input.productId);
    if (!product || product.status !== "operational") throw new LedgerRequestError("Product is not open for subscriptions");
    const investor = await this.ensureInvestor(input.subject, input.email, input.walletAddress);
    // References are unique per investor, and repeating one returns the original request.
    const clientReference = `${investor.id}:${input.clientReference}`;
    const existing = await this.db.prepare("SELECT id, status, expected_shares_micros FROM subscriptions WHERE client_reference = ?").bind(clientReference).first<{ id: string; status: string; expected_shares_micros: string }>();
    if (existing) return { id: existing.id, status: existing.status, expectedSharesMicros: existing.expected_shares_micros };
    if (await this.openRequestCount(investor.id) >= MAX_OPEN_REQUESTS) throw new LedgerRequestError(`At most ${MAX_OPEN_REQUESTS} requests can be pending at once`);
    const nav = await this.latestNav(input.productId);
    const navPerShareMicros = nav ? asBigInt(nav.nav_per_share_micros) : INITIAL_NAV_PER_SHARE_MICROS;
    // An estimate only: shares are issued at the first NAV calculated after the request.
    const expectedShares = sharesForSubscription(input.amountKrw, navPerShareMicros);
    const id = newId("subscription");
    const status = investor.kycStatus === "verified" ? "funding" : "kyc_review";
    await this.db.prepare(`
      INSERT INTO subscriptions (
        id, investor_id, product_id, amount_krw, expected_shares_micros,
        issued_shares_micros, status, client_reference
      ) VALUES (?, ?, ?, ?, ?, '0', ?, ?)
    `).bind(id, investor.id, input.productId, input.amountKrw.toString(), expectedShares.toString(), status, clientReference).run();
    await this.audit("subscription.requested", "subscription", id, input.subject, { productId: input.productId, amountKrw: input.amountKrw.toString(), status });
    return { id, status, expectedSharesMicros: expectedShares.toString() };
  }

  async listSubscriptionsForProcessing(paperMode: boolean): Promise<SubscriptionRow[]> {
    const statuses = paperMode ? PENDING_SUBSCRIPTION_SQL : "('executing')";
    // Forward pricing: a request waits until a NAV has been calculated after it.
    return (await this.db.prepare(`
      SELECT s.*, i.wallet_address, i.kyc_status FROM subscriptions s
      JOIN investors i ON i.id = s.investor_id
      WHERE s.status IN ${statuses}
        AND EXISTS (SELECT 1 FROM nav_snapshots n WHERE n.product_id = s.product_id AND n.quality IN ${PRICING_QUALITY_SQL} AND n.as_of >= strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at, '+1 second'))
      ORDER BY s.created_at LIMIT 25
    `).all<SubscriptionRow>()).results;
  }

  /**
   * The first NAV calculated after a request: deterministic, so a retried settlement prices
   * identically. created_at is stored to the second, so the NAV must be at least one second
   * later to be certain it follows the request.
   */
  async navForSettlement(productId: string, createdAt: string): Promise<NavRow | null> {
    return await this.db.prepare(`
      SELECT * FROM nav_snapshots
      WHERE product_id = ? AND quality IN ${PRICING_QUALITY_SQL} AND as_of >= strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+1 second')
      ORDER BY as_of ASC LIMIT 1
    `).bind(productId, createdAt).first<NavRow>();
  }

  async settleSubscription(row: SubscriptionRow, settlement: SettlementResult | null, paperMode: boolean, shares: bigint, navPerShareMicros: bigint): Promise<{ status: "settled" | "rejected" | "pending"; reason: string | null }> {
    const decision = settlementDecision(settlement, paperMode);
    if (decision === "wait") {
      await this.db.prepare(`UPDATE subscriptions SET status = 'executing', expected_shares_micros = ?, giwa_tx_hash = COALESCE(?, giwa_tx_hash) WHERE id = ? AND status IN ${PENDING_SUBSCRIPTION_SQL}`)
        .bind(shares.toString(), settlement?.txHash ?? null, row.id).run();
      return { status: "pending", reason: settlement?.error ?? null };
    }
    const product = await this.getProduct(row.product_id);
    const amount = asBigInt(row.amount_krw);
    const overflow = !product || asBigInt(product.shares_outstanding_micros) + shares >= LEDGER_LIMIT || asBigInt(product.cash_balance_krw) + amount >= LEDGER_LIMIT;
    if (decision === "reject" || overflow) {
      const reason = overflow ? "The subscription would exceed the ledger's numeric range" : settlement?.error ?? "Settlement was rejected";
      const result = await this.db.prepare(`UPDATE subscriptions SET status = 'rejected', giwa_tx_hash = COALESCE(?, giwa_tx_hash) WHERE id = ? AND status IN ${PENDING_SUBSCRIPTION_SQL}`)
        .bind(settlement?.txHash ?? null, row.id).run();
      if (changedRows(result)) await this.audit("subscription.rejected", "subscription", row.id, "ENGINE", { reason });
      return { status: "rejected", reason };
    }
    const results = await this.db.batch([
      this.db.prepare(`
        UPDATE subscriptions SET status = 'settled', expected_shares_micros = ?, issued_shares_micros = ?,
          giwa_tx_hash = COALESCE(?, giwa_tx_hash), settled_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ${PENDING_SUBSCRIPTION_SQL}
      `).bind(shares.toString(), shares.toString(), settlement?.txHash ?? null, row.id),
      // The next two statements apply only if the status change above happened (changes() = 1),
      // so a second worker settling the same row cannot credit the position or the fund twice.
      this.db.prepare(`
        INSERT INTO investor_positions (investor_id, product_id, shares_micros, cost_basis_krw)
        SELECT ?, ?, ?, ? WHERE changes() = 1
        ON CONFLICT(investor_id, product_id) DO UPDATE SET
          shares_micros = CAST(CAST(investor_positions.shares_micros AS INTEGER) + CAST(excluded.shares_micros AS INTEGER) AS TEXT),
          cost_basis_krw = CAST(CAST(investor_positions.cost_basis_krw AS INTEGER) + CAST(excluded.cost_basis_krw AS INTEGER) AS TEXT),
          updated_at = CURRENT_TIMESTAMP
      `).bind(row.investor_id, row.product_id, shares.toString(), row.amount_krw),
      this.db.prepare(`
        UPDATE products SET
          shares_outstanding_micros = CAST(CAST(shares_outstanding_micros AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
          cash_balance_krw = CAST(CAST(cash_balance_krw AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND changes() = 1
      `).bind(shares.toString(), row.amount_krw, row.product_id),
    ]);
    if (!changedRows(results[0])) return { status: "pending", reason: "Already settled by another worker" };
    await this.audit("subscription.settled", "subscription", row.id, "ENGINE", { sharesMicros: shares.toString(), navPerShareMicros: navPerShareMicros.toString(), paperMode });
    return { status: "settled", reason: null };
  }

  async createRedemption(input: { subject: string; email?: string | null; walletAddress?: string | null; productId: string; sharesMicros: bigint; clientReference: string }): Promise<{ id: string; status: string }> {
    if (input.sharesMicros <= 0n) throw new LedgerRequestError("Redemption shares must be positive");
    const investor = await this.ensureInvestor(input.subject, input.email, input.walletAddress);
    const clientReference = `${investor.id}:${input.clientReference}`;
    const existing = await this.db.prepare("SELECT id, status FROM redemptions WHERE client_reference = ?").bind(clientReference).first<{ id: string; status: string }>();
    if (existing) return { id: existing.id, status: existing.status };
    if (await this.openRequestCount(investor.id) >= MAX_OPEN_REQUESTS) throw new LedgerRequestError(`At most ${MAX_OPEN_REQUESTS} requests can be pending at once`);
    const id = newId("redemption");
    const status = investor.kycStatus === "verified" ? "locked" : "requested";
    // Reserve the shares atomically: the row is inserted only while the holding, less every
    // pending redemption, still covers it. Repeated requests cannot redeem the same shares twice.
    const result = await this.db.prepare(`
      INSERT INTO redemptions (id, investor_id, product_id, requested_shares_micros, proceeds_krw, status, client_reference)
      SELECT ?, ?, ?, ?, '0', ?, ?
      WHERE (SELECT CAST(shares_micros AS INTEGER) FROM investor_positions WHERE investor_id = ? AND product_id = ?)
          - (SELECT COALESCE(SUM(CAST(requested_shares_micros AS INTEGER)), 0) FROM redemptions WHERE investor_id = ? AND product_id = ? AND status IN ${PENDING_REDEMPTION_SQL})
          >= CAST(? AS INTEGER)
    `).bind(
      id, investor.id, input.productId, input.sharesMicros.toString(), status, clientReference,
      investor.id, input.productId, investor.id, input.productId, input.sharesMicros.toString(),
    ).run();
    if (!changedRows(result)) throw new LedgerRequestError("Insufficient ETF shares");
    await this.audit("redemption.requested", "redemption", id, input.subject, { productId: input.productId, sharesMicros: input.sharesMicros.toString(), status });
    return { id, status };
  }

  async listRedemptionsForProcessing(paperMode: boolean): Promise<RedemptionRow[]> {
    const statuses = paperMode ? PENDING_REDEMPTION_SQL : "('executing')";
    return (await this.db.prepare(`
      SELECT r.*, i.wallet_address, i.kyc_status FROM redemptions r
      JOIN investors i ON i.id = r.investor_id
      WHERE r.status IN ${statuses}
        AND EXISTS (SELECT 1 FROM nav_snapshots n WHERE n.product_id = r.product_id AND n.quality IN ${PRICING_QUALITY_SQL} AND n.as_of >= strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at, '+1 second'))
      ORDER BY r.created_at LIMIT 25
    `).all<RedemptionRow>()).results;
  }

  async settleRedemption(row: RedemptionRow, settlement: SettlementResult | null, paperMode: boolean, proceeds: bigint): Promise<{ status: "settled" | "rejected" | "pending"; reason: string | null }> {
    const decision = settlementDecision(settlement, paperMode);
    if (decision === "wait") {
      await this.db.prepare(`UPDATE redemptions SET status = 'executing', giwa_tx_hash = COALESCE(?, giwa_tx_hash) WHERE id = ? AND status IN ${PENDING_REDEMPTION_SQL}`)
        .bind(settlement?.txHash ?? null, row.id).run();
      return { status: "pending", reason: settlement?.error ?? null };
    }
    const shares = asBigInt(row.requested_shares_micros);
    const position = await this.db.prepare("SELECT shares_micros, cost_basis_krw, realized_pnl_krw FROM investor_positions WHERE investor_id = ? AND product_id = ?")
      .bind(row.investor_id, row.product_id).first<{ shares_micros: string; cost_basis_krw: string; realized_pnl_krw: string }>();
    if (decision === "reject" || !position || asBigInt(position.shares_micros) < shares) {
      const reason = decision === "reject" ? settlement?.error ?? "Settlement was rejected" : "Insufficient ETF shares at settlement";
      const result = await this.db.prepare(`UPDATE redemptions SET status = 'rejected', giwa_tx_hash = COALESCE(?, giwa_tx_hash) WHERE id = ? AND status IN ${PENDING_REDEMPTION_SQL}`)
        .bind(settlement?.txHash ?? null, row.id).run();
      if (changedRows(result)) await this.audit("redemption.rejected", "redemption", row.id, "ENGINE", { reason });
      return { status: "rejected", reason };
    }
    const held = asBigInt(position.shares_micros);
    const cost = asBigInt(position.cost_basis_krw);
    // Cost basis leaves in proportion to the shares redeemed; the rest is realized gain or loss.
    const costRemoved = shares === held ? cost : cost * shares / held;
    const realized = asBigInt(position.realized_pnl_krw) + proceeds - costRemoved;
    const results = await this.db.batch([
      // Compare-and-set on the position read above, and only while the fund holds the cash.
      this.db.prepare(`
        UPDATE investor_positions SET shares_micros = ?, cost_basis_krw = ?, realized_pnl_krw = ?, updated_at = CURRENT_TIMESTAMP
        WHERE investor_id = ? AND product_id = ? AND shares_micros = ? AND cost_basis_krw = ? AND realized_pnl_krw = ?
          AND EXISTS (SELECT 1 FROM redemptions WHERE id = ? AND status IN ${PENDING_REDEMPTION_SQL})
          AND (SELECT CAST(cash_balance_krw AS INTEGER) FROM products WHERE id = ?) >= CAST(? AS INTEGER)
          AND (SELECT CAST(shares_outstanding_micros AS INTEGER) FROM products WHERE id = ?) >= CAST(? AS INTEGER)
      `).bind(
        (held - shares).toString(), (cost - costRemoved).toString(), realized.toString(),
        row.investor_id, row.product_id, position.shares_micros, position.cost_basis_krw, position.realized_pnl_krw,
        row.id, row.product_id, proceeds.toString(), row.product_id, shares.toString(),
      ),
      this.db.prepare(`
        UPDATE redemptions SET status = 'settled', proceeds_krw = ?, giwa_tx_hash = COALESCE(?, giwa_tx_hash), settled_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ${PENDING_REDEMPTION_SQL} AND changes() = 1
      `).bind(proceeds.toString(), settlement?.txHash ?? null, row.id),
      this.db.prepare(`
        UPDATE products SET
          shares_outstanding_micros = CAST(CAST(shares_outstanding_micros AS INTEGER) - CAST(? AS INTEGER) AS TEXT),
          cash_balance_krw = CAST(CAST(cash_balance_krw AS INTEGER) - CAST(? AS INTEGER) AS TEXT),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND changes() = 1
      `).bind(shares.toString(), proceeds.toString(), row.product_id),
    ]);
    if (!changedRows(results[1])) return { status: "pending", reason: "Awaiting fund cash or a concurrent update" };
    await this.audit("redemption.settled", "redemption", row.id, "ENGINE", { sharesMicros: shares.toString(), proceedsKrw: proceeds.toString(), paperMode });
    return { status: "settled", reason: null };
  }

  async portfolio(subject: string): Promise<{ investor: { id: string; kycStatus: string; walletAddress: string | null } | null; positions: Array<Record<string, unknown>>; subscriptions: Array<Record<string, unknown>>; redemptions: Array<Record<string, unknown>> }> {
    const investor = await this.db.prepare("SELECT id, kyc_status, wallet_address FROM investors WHERE external_subject = ?").bind(subject).first<{ id: string; kyc_status: string; wallet_address: string | null }>();
    if (!investor) return { investor: null, positions: [], subscriptions: [], redemptions: [] };
    const positions = (await this.db.prepare(`
      SELECT ip.product_id, p.slug, p.ticker, p.name, p.strategy_style,
        ip.shares_micros, ip.cost_basis_krw, ip.realized_pnl_krw,
        n.nav_per_share_micros, n.as_of
      FROM investor_positions ip
      JOIN products p ON p.id = ip.product_id
      LEFT JOIN nav_snapshots n ON n.id = (
        SELECT id FROM nav_snapshots WHERE product_id = ip.product_id ORDER BY as_of DESC LIMIT 1
      )
      WHERE ip.investor_id = ? AND CAST(ip.shares_micros AS INTEGER) > 0
      ORDER BY p.ticker
    `).bind(investor.id).all<Record<string, string>>()).results.map((row) => {
      const shares = asBigInt(row.shares_micros);
      const nav = asBigInt(row.nav_per_share_micros || INITIAL_NAV_PER_SHARE_MICROS);
      const value = krwForShares(shares, nav);
      const cost = asBigInt(row.cost_basis_krw);
      return {
        productId: row.product_id,
        slug: row.slug,
        ticker: row.ticker,
        name: row.name,
        strategyStyle: row.strategy_style,
        sharesMicros: shares.toString(),
        costBasisKrw: cost.toString(),
        currentValueKrw: value.toString(),
        unrealizedPnlKrw: (value - cost).toString(),
        returnBps: cost > 0n ? Number((value - cost) * 10_000n / cost) : 0,
        navPerShareMicros: nav.toString(),
        navAsOf: row.as_of,
      };
    });
    const subscriptions = (await this.db.prepare("SELECT id, product_id, amount_krw, expected_shares_micros, issued_shares_micros, status, client_reference, created_at, settled_at FROM subscriptions WHERE investor_id = ? ORDER BY created_at DESC LIMIT 50").bind(investor.id).all<Record<string, unknown>>()).results;
    const redemptions = (await this.db.prepare("SELECT id, product_id, requested_shares_micros, proceeds_krw, status, client_reference, created_at, settled_at FROM redemptions WHERE investor_id = ? ORDER BY created_at DESC LIMIT 50").bind(investor.id).all<Record<string, unknown>>()).results;
    return { investor: { id: investor.id, kycStatus: investor.kyc_status, walletAddress: investor.wallet_address }, positions, subscriptions, redemptions };
  }

  async marketOverview(): Promise<Record<string, unknown>> {
    const products = await this.listProducts();
    const productViews = await Promise.all(products.map(async (product) => {
      const [nav, targets, lastRebalance] = await Promise.all([
        this.latestNav(product.id),
        this.db.prepare(`
          SELECT symbol, target_weight_bps, rationale, effective_at FROM target_allocations
          WHERE product_id = ? AND effective_at = (SELECT MAX(effective_at) FROM target_allocations WHERE product_id = ?)
          ORDER BY target_weight_bps DESC
        `).bind(product.id, product.id).all<Record<string, unknown>>(),
        this.db.prepare("SELECT id, status, turnover_bps, completed_at, error FROM rebalance_runs WHERE product_id = ? ORDER BY created_at DESC LIMIT 1").bind(product.id).first<Record<string, unknown>>(),
      ]);
      return {
        id: product.id,
        slug: product.slug,
        ticker: product.ticker,
        name: product.name,
        strategyStyle: product.strategy_style,
        status: product.status,
        nav: nav ? {
          navPerShareMicros: nav.nav_per_share_micros,
          netAssetValueKrw: nav.net_asset_value_krw,
          sharesOutstandingMicros: nav.shares_outstanding_micros,
          asOf: nav.as_of,
          quality: nav.quality,
        } : null,
        targets: targets.results,
        lastRebalance,
      };
    }));
    const lastCycle = await this.db.prepare("SELECT value, updated_at FROM engine_state WHERE key = 'last_cycle'").first<{ value: string; updated_at: string }>();
    return { products: productViews, lastCycle: lastCycle ? JSON.parse(lastCycle.value) : null, updatedAt: lastCycle?.updated_at ?? null };
  }

  async operationsStatus(): Promise<Record<string, unknown>> {
    const [lastCycle, counts, recentOrders, recentRebalances, recentSettlements] = await Promise.all([
      this.db.prepare("SELECT value, updated_at FROM engine_state WHERE key = 'last_cycle'").first<{ value: string; updated_at: string }>(),
      this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM products WHERE status = 'operational') AS operational_products,
          (SELECT COUNT(*) FROM orders WHERE status IN ('pending','submitted','partially_filled')) AS open_orders,
          (SELECT COUNT(*) FROM subscriptions WHERE status NOT IN ('settled','rejected','cancelled')) AS open_subscriptions,
          (SELECT COUNT(*) FROM redemptions WHERE status NOT IN ('settled','rejected','cancelled')) AS open_redemptions,
          (SELECT COUNT(*) FROM giwa_settlements WHERE status IN ('queued','submitted')) AS pending_settlements
      `).first<Record<string, number>>(),
      this.db.prepare("SELECT id, product_id, symbol, side, requested_notional_krw, status, venue, venue_order_id, error, created_at FROM orders ORDER BY created_at DESC LIMIT 20").all<Record<string, unknown>>(),
      this.db.prepare("SELECT id, product_id, strategy_style, status, turnover_bps, trigger, scheduled_for, completed_at, error FROM rebalance_runs ORDER BY created_at DESC LIMIT 20").all<Record<string, unknown>>(),
      this.db.prepare("SELECT entity_type, entity_id, action, status, tx_hash, error, updated_at FROM giwa_settlements ORDER BY updated_at DESC LIMIT 20").all<Record<string, unknown>>(),
    ]);
    return {
      lastCycle: lastCycle ? JSON.parse(lastCycle.value) : null,
      lastCycleAt: lastCycle?.updated_at ?? null,
      counts: counts ?? {},
      recentOrders: recentOrders.results,
      recentRebalances: recentRebalances.results,
      recentSettlements: recentSettlements.results,
    };
  }

  async saveCycle(result: EngineCycleResult): Promise<void> {
    await this.db.prepare(`
      INSERT INTO engine_state (key, value, updated_at) VALUES ('last_cycle', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(JSON.stringify(result)).run();
    await this.audit("engine.cycle_completed", "engine", result.cycleId, "ENGINE", result);
  }

  /** Confirmed NAV publications whose entity id starts with the prefix, newest first, older than `before` when given. */
  async confirmedNavSettlements(entityPrefix: string, before: string | null, limit: number): Promise<{ entityId: string; txHash: string }[]> {
    const pattern = `${entityPrefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const olderThan = before ? " AND entity_id < ?" : "";
    const { results } = await this.db.prepare(`
      SELECT entity_id, tx_hash FROM giwa_settlements
      WHERE entity_type = 'nav' AND action = 'publish_nav' AND status = 'confirmed' AND tx_hash IS NOT NULL
        AND entity_id LIKE ? ESCAPE '\\'${olderThan}
      ORDER BY entity_id DESC LIMIT ?
    `).bind(...(before ? [pattern, before, limit] : [pattern, limit])).all<{ entity_id: string; tx_hash: string }>();
    return (results ?? []).map((row) => ({ entityId: row.entity_id, txHash: row.tx_hash }));
  }

  async getState(key: string): Promise<{ value: string; updatedAt: string } | null> {
    const row = await this.db.prepare("SELECT value, updated_at FROM engine_state WHERE key = ?").bind(key).first<{ value: string; updated_at: string }>();
    return row ? { value: row.value, updatedAt: row.updated_at } : null;
  }

  /** Delete every state row whose key starts with `prefix`, except the keys listed. */
  async deleteStatesWithPrefix(prefix: string, keep: string[]): Promise<void> {
    const pattern = `${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const exclusions = keep.length ? ` AND key NOT IN (${keep.map(() => "?").join(", ")})` : "";
    await this.db.prepare(`DELETE FROM engine_state WHERE key LIKE ? ESCAPE '\\'${exclusions}`).bind(pattern, ...keep).run();
  }

  async setState(key: string, value: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO engine_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(key, value).run();
  }

  async audit(eventType: string, entityType: string, entityId: string, actor: string, payload: unknown): Promise<void> {
    const payloadJson = stableJson(payload);
    const payloadHash = await sha256Hex(payloadJson);
    await this.db.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, actor, payload_json, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(newId("audit"), eventType, entityType, entityId, actor, payloadJson, payloadHash).run();
  }
}

export function productDefinition(productId: string): ProductDefinition {
  const product = PRODUCT_DEFINITIONS.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`Unknown product ${productId}`);
  return product;
}

export function assetDefinition(symbol: string): AssetDefinition {
  const asset = ASSET_UNIVERSE.find((candidate) => candidate.symbol === symbol);
  if (!asset) throw new Error(`Unknown asset ${symbol}`);
  return asset;
}
