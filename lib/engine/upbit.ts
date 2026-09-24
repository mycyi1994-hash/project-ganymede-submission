import { base64Url, newId, notionalToUnitsAtomic, sha256Hex } from "./fixed";
import { REFERENCE_HISTORY_MULTIPLIERS } from "./seed";
import type { AssetDefinition, DailyCandle, EngineEnv, ExecutionResult, MarketTick, OrderIntent, TradingMode } from "./types";

const UPBIT_API = "https://api.upbit.com";
const LIVE_CONFIRMATION = "ENABLE_GANYMEDE_LIVE_UPBIT_ORDERS";

type UpbitTicker = {
  market: string;
  trade_price: number;
  acc_trade_price_24h: number;
  signed_change_rate: number;
  timestamp: number;
};

type UpbitOrderbook = {
  market: string;
  timestamp: number;
  orderbook_units: Array<{ ask_price: number; bid_price: number }>;
};

type UpbitCandle = {
  market: string;
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_price: number;
};

function abortAfter(milliseconds: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), milliseconds);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<T> {
  const { signal, cleanup } = abortAfter(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`Upbit ${response.status}: ${await response.text()}`);
    return await response.json() as T;
  } finally {
    cleanup();
  }
}

function referenceTick(asset: AssetDefinition, asOf: string): MarketTick {
  const spread = Math.max(1, Math.round(asset.referencePriceKrw * 0.0007));
  return {
    symbol: asset.symbol,
    market: asset.market,
    priceKrw: asset.referencePriceKrw,
    bidKrw: asset.referencePriceKrw - spread,
    askKrw: asset.referencePriceKrw + spread,
    volume24hKrw: asset.referenceVolume24hKrw,
    change24hBps: 0,
    source: "REFERENCE",
    quality: "reference",
    asOf,
  };
}

export async function fetchMarketSnapshot(assets: AssetDefinition[]): Promise<{ ticks: MarketTick[]; warnings: string[] }> {
  const asOf = new Date().toISOString();
  const markets = assets.map((asset) => asset.market).join(",");
  try {
    const [tickers, orderbooks] = await Promise.all([
      fetchJson<UpbitTicker[]>(`${UPBIT_API}/v1/ticker?markets=${encodeURIComponent(markets)}`),
      fetchJson<UpbitOrderbook[]>(`${UPBIT_API}/v1/orderbook?markets=${encodeURIComponent(markets)}`),
    ]);
    const tickerByMarket = new Map(tickers.map((ticker) => [ticker.market, ticker]));
    const orderbookByMarket = new Map(orderbooks.map((orderbook) => [orderbook.market, orderbook]));
    return {
      ticks: assets.map((asset) => {
        const ticker = tickerByMarket.get(asset.market);
        const book = orderbookByMarket.get(asset.market);
        const best = book?.orderbook_units?.[0];
        if (!ticker?.trade_price || !best?.bid_price || !best?.ask_price) return referenceTick(asset, asOf);
        return {
          symbol: asset.symbol,
          market: asset.market,
          priceKrw: Math.round(ticker.trade_price),
          bidKrw: Math.round(best.bid_price),
          askKrw: Math.round(best.ask_price),
          volume24hKrw: Math.round(ticker.acc_trade_price_24h),
          change24hBps: Math.round(ticker.signed_change_rate * 10_000),
          source: "UPBIT",
          quality: Date.now() - ticker.timestamp > 60_000 ? "stale" : "live",
          asOf: new Date(ticker.timestamp).toISOString(),
        };
      }),
      warnings: [],
    };
  } catch (error) {
    return {
      ticks: assets.map((asset) => referenceTick(asset, asOf)),
      warnings: [`Upbit market data unavailable; reference data used: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }
}

function referenceCandles(asset: AssetDefinition, count: number): DailyCandle[] {
  const history = REFERENCE_HISTORY_MULTIPLIERS.slice(-Math.min(count, REFERENCE_HISTORY_MULTIPLIERS.length));
  const endingMultiplier = history.at(-1) ?? 1;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return history.map((multiplier, index) => {
    const date = new Date(day.getTime() - (history.length - index - 1) * 86_400_000);
    const symbolTilt = 1 + ((asset.symbol.charCodeAt(0) + index * 7) % 9 - 4) / 100;
    const close = Math.max(1, Math.round(asset.referencePriceKrw * multiplier / endingMultiplier * symbolTilt));
    const open = Math.max(1, Math.round(close * (1 + ((index % 5) - 2) / 200)));
    return {
      symbol: asset.symbol,
      candleDate: date.toISOString().slice(0, 10),
      openKrw: open,
      highKrw: Math.max(open, close) + Math.round(close * 0.015),
      lowKrw: Math.max(1, Math.min(open, close) - Math.round(close * 0.015)),
      closeKrw: close,
      volumeKrw: Math.round(asset.referenceVolume24hKrw * (0.7 + (index % 7) * 0.07)),
      source: "REFERENCE",
    };
  });
}

export async function fetchDailyCandles(asset: AssetDefinition, count = 91): Promise<{ candles: DailyCandle[]; warning: string | null }> {
  try {
    const rows = await fetchJson<UpbitCandle[]>(`${UPBIT_API}/v1/candles/days?market=${asset.market}&count=${Math.min(200, count)}`);
    const candles = rows.map((row) => ({
      symbol: asset.symbol,
      candleDate: row.candle_date_time_utc.slice(0, 10),
      openKrw: Math.round(row.opening_price),
      highKrw: Math.round(row.high_price),
      lowKrw: Math.round(row.low_price),
      closeKrw: Math.round(row.trade_price),
      volumeKrw: Math.round(row.candle_acc_trade_price),
      source: "UPBIT" as const,
    })).sort((a, b) => a.candleDate.localeCompare(b.candleDate));
    if (candles.length < 30) throw new Error(`Only ${candles.length} candles returned`);
    return { candles, warning: null };
  } catch (error) {
    return {
      candles: referenceCandles(asset, count),
      warning: `Reference candles used for ${asset.symbol}: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

async function sha512Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signUpbitJwt(accessKey: string, secretKey: string, queryString: string): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
  const payload: Record<string, string> = { access_key: accessKey, nonce: crypto.randomUUID() };
  if (queryString) {
    payload.query_hash = await sha512Hex(queryString);
    payload.query_hash_alg = "SHA512";
  }
  const encodedPayload = base64Url(JSON.stringify(payload));
  const message = `${header}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return `${message}.${base64Url(signature)}`;
}

function formatUnits(unitsAtomic: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = unitsAtomic / scale;
  const fraction = (unitsAtomic % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function orderBody(intent: OrderIntent, decimals: number): Record<string, string> {
  if (intent.side === "buy" && intent.orderType === "market") {
    return { market: intent.market, side: "bid", price: intent.requestedNotionalKrw.toString(), ord_type: "price", identifier: intent.idempotencyKey };
  }
  if (intent.side === "sell" && intent.orderType === "market") {
    if (!intent.requestedUnitsAtomic) throw new Error("Market sell requires requested units");
    return { market: intent.market, side: "ask", volume: formatUnits(intent.requestedUnitsAtomic, decimals), ord_type: "market", identifier: intent.idempotencyKey };
  }
  if (!intent.limitPriceKrw || !intent.requestedUnitsAtomic) throw new Error("Limit order requires price and units");
  return {
    market: intent.market,
    side: intent.side === "buy" ? "bid" : "ask",
    volume: formatUnits(intent.requestedUnitsAtomic, decimals),
    price: intent.limitPriceKrw.toString(),
    ord_type: "limit",
    identifier: intent.idempotencyKey,
  };
}

export class UpbitExecutionClient {
  readonly mode: TradingMode;
  private readonly env: EngineEnv;

  constructor(env: EngineEnv) {
    this.env = env;
    this.mode = env.TRADING_MODE === "live" ? "live" : "paper";
  }

  private assertLiveConfiguration(): void {
    if (this.mode !== "live") return;
    if (this.env.LIVE_TRADING_CONFIRMATION !== LIVE_CONFIRMATION) throw new Error("Live trading confirmation is missing");
    if (!this.env.UPBIT_ACCESS_KEY || !this.env.UPBIT_SECRET_KEY) throw new Error("Upbit live credentials are missing");
  }

  async execute(intent: OrderIntent, tick: MarketTick, decimals: number): Promise<ExecutionResult> {
    if (this.mode === "paper") {
      const basePrice = BigInt(Math.max(1, Math.round(intent.side === "buy" ? tick.askKrw : tick.bidKrw)));
      const slippageBps = 8n;
      const executedPrice = intent.side === "buy" ? basePrice * (10_000n + slippageBps) / 10_000n : basePrice * (10_000n - slippageBps) / 10_000n;
      const units = intent.requestedUnitsAtomic ?? notionalToUnitsAtomic(intent.requestedNotionalKrw, executedPrice, decimals);
      return {
        status: "simulated",
        venueOrderId: newId("paper"),
        executedPriceKrw: executedPrice,
        executedUnitsAtomic: units,
        feeKrw: intent.requestedNotionalKrw * 5n / 10_000n,
        error: null,
      };
    }

    try {
      this.assertLiveConfiguration();
      const body = orderBody(intent, decimals);
      const queryString = new URLSearchParams(body).toString();
      const token = await signUpbitJwt(this.env.UPBIT_ACCESS_KEY!, this.env.UPBIT_SECRET_KEY!, queryString);
      const response = await fetchJson<{ uuid: string; state: string }>(`${UPBIT_API}/v1/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, 10_000);
      return { status: "submitted", venueOrderId: response.uuid, executedPriceKrw: null, executedUnitsAtomic: null, feeKrw: 0n, error: null };
    } catch (error) {
      return { status: "rejected", venueOrderId: null, executedPriceKrw: null, executedUnitsAtomic: null, feeKrw: 0n, error: error instanceof Error ? error.message : "Unknown Upbit execution error" };
    }
  }

  async health(): Promise<{ mode: TradingMode; configured: boolean; fingerprint: string | null }> {
    const configured = this.mode === "paper" || Boolean(this.env.UPBIT_ACCESS_KEY && this.env.UPBIT_SECRET_KEY && this.env.LIVE_TRADING_CONFIRMATION === LIVE_CONFIRMATION);
    return {
      mode: this.mode,
      configured,
      fingerprint: this.env.UPBIT_ACCESS_KEY ? (await sha256Hex(this.env.UPBIT_ACCESS_KEY)).slice(0, 14) : null,
    };
  }
}
