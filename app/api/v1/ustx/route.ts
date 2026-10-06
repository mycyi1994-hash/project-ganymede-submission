import { engineEnv } from "@/lib/engine/api-helpers";
import { SettlementClient } from "@/lib/engine/settlement";
import { cachedRead } from "@/lib/read-cache";
import { POOL_FACTORY, POOL_FEE, POOL_TOLERANCE, XSTOCK_POOLS } from "@/lib/xstocks/pool-prices";
import { XSTOCKS_CHAIN, XSTOCKS_CONSTITUENTS, XSTOCKS_PRODUCT } from "@/lib/xstocks/basket";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
import { navForRequest } from "@/lib/xstocks/nav-api";

export const dynamic = "force-dynamic";

// Any site or app may read this: a public record, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

/** GanymedeBasketFund.MAX_NAV_AGE: orders and loans use a record for one hour after its time. */
const NAV_VALIDITY_MS = 3_600_000;
const usd = (micros: string) => `${BigInt(micros) / 1_000_000n}.${(BigInt(micros) % 1_000_000n).toString().padStart(6, "0")}`;

/**
 * Each Worker isolate keeps what it served for 30 seconds. Behind that, the once-a-minute cron's
 * snapshot is served while under 90 seconds old, and X Layer is read only when it is older; when
 * X Layer cannot be read, a snapshot up to 10 minutes old is served, marked stale.
 */
export const NAV_FRESH_MS = 30_000;
export const NAV_STALE_MS = 10 * 60_000;

/** The latest USTX NAV record, read from the registry on X Layer at readAt. Reads only. */
export async function GET(request: Request) {
  const env = engineEnv();
  const origin = new URL(request.url).origin;
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  const settlement = new SettlementClient(env);
  try {
    const { value: read, stale: memoryStale } = await cachedRead("ustx-nav", () => navForRequest(env, NAV_STALE_MS), { freshMs: NAV_FRESH_MS, staleMs: NAV_STALE_MS });
    const { record, transactionHash, calculatedAt, wallets } = read.body;
    const stale = memoryStale || read.stale;
    return json({
      product: { id: XSTOCKS_PRODUCT.id, ticker: "USTX", name: "US Tech Basket", constituents: XSTOCKS_CONSTITUENTS.map(constituent => constituent.symbol) },
      nav: {
        perShareUsd: usd(record.navPerShareMicros),
        perShareMicros: record.navPerShareMicros,
        sharesOutstandingMicros: record.sharesOutstandingMicros,
        effectiveAt: record.effectiveAt,
        calculatedAt,
        validUntil: new Date(Date.parse(record.effectiveAt) + NAV_VALIDITY_MS).toISOString(),
        usableForOrders: Date.now() < Date.parse(record.effectiveAt) + NAV_VALIDITY_MS,
        timeRule: "effectiveAt is the time of the record's oldest price, never later than calculatedAt. The fund and the lending market accept the NAV until validUntil, one hour after effectiveAt; usableForOrders says whether that is still so. stale describes this read, not the record.",
        recordedAt: record.publishedAt,
        holdingsHash: record.holdingsHash,
      },
      record: {
        network: settlement.chain.name,
        chainId: settlement.chain.chainId,
        registry: registry.toLowerCase(),
        transactionHash,
        explorerUrl: transactionHash ? `${settlement.chain.explorerUrl}/tx/${transactionHash}` : `${settlement.chain.explorerUrl}/address/${registry.toLowerCase()}`,
      },
      pricing: {
        source: "OKX OnchainOS", chain: XSTOCKS_CHAIN.name, chainIndex: XSTOCKS_CHAIN.chainIndex, interval: "5 minutes",
        // The second source every record is compared with, so a partner can repeat the comparison from the chain.
        crossCheck: {
          source: "Uniswap V3 pools on X Layer mainnet", factory: POOL_FACTORY, feeTier: POOL_FEE,
          toleranceBps: { nav: POOL_TOLERANCE.navBps },
          rule: "A NAV is not recorded if its value at the pool prices differs by more than toleranceBps.nav; the limit applies to the NAV only, and when the pools cannot be read the record goes ahead with a warning. feeTier is the Uniswap V3 fee tier in hundredths of a basis point (500 = 0.05%).",
          pools: XSTOCK_POOLS.map((entry) => ({ symbol: entry.symbol, pool: entry.pool, wrapper: entry.wrapper, quote: entry.stable.symbol })),
        },
      },
      shares: {
        token: FUND_DEPLOYMENT.fund,
        symbol: "USTX",
        decimals: 6,
        network: FUND_DEPLOYMENT.name,
        chainId: FUND_DEPLOYMENT.chainId,
        rule: "invest() and redeem() fill at this registry's latest NAV when it is at most an hour old; nothing else issues shares.",
        paidWith: { token: FUND_DEPLOYMENT.dollar, symbol: "dUSD", value: "none (testnet demo dollars)" },
        explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/token/${FUND_DEPLOYMENT.fund}`,
        outstanding: {
          recordedMicros: record.sharesOutstandingMicros,
          inWalletsMicros: wallets?.sharesMicros ?? null,
          rule: "Every share is this token, held in wallets: it trades in the pools and serves as loan collateral. inWalletsMicros is read now; the recorded count is as of the NAV.",
        },
      },
      feed: {
        address: FUND_DEPLOYMENT.feed,
        interface: "AggregatorV3Interface",
        description: "USTX / USD",
        decimals: 8,
        network: FUND_DEPLOYMENT.name,
        chainId: FUND_DEPLOYMENT.chainId,
        rule: "latestRoundData() answers this registry's latest NAV with 8 decimals; roundId and updatedAt are its effective time.",
        explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.feed}`,
      },
      market: {
        pool: FUND_DEPLOYMENT.pool,
        arbitrage: FUND_DEPLOYMENT.arbitrage,
        keeper: FUND_DEPLOYMENT.keeper,
        network: FUND_DEPLOYMENT.name,
        chainId: FUND_DEPLOYMENT.chainId,
        rule: "A constant-product USTX/dUSD pool with a 0.3% fee; premiumBps() gives its gap to the NAV, and the arbitrage contract closes it through the fund in one transaction; a keeper checks every five minutes and does so when closing the gap earns at least a cent.",
        explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.pool}`,
      },
      lending: {
        market: FUND_DEPLOYMENT.lending,
        network: FUND_DEPLOYMENT.name,
        chainId: FUND_DEPLOYMENT.chainId,
        rule: "Borrow demo dollars up to 50% of USTX collateral valued at the fund's currentNav(); past 65% anyone can repay up to half and take USTX worth 8% more.",
        explorerUrl: `${FUND_DEPLOYMENT.explorerUrl}/address/${FUND_DEPLOYMENT.lending}`,
      },
      verify: {
        page: `${origin}/products/ustx/transparency`,
        documents: `${origin}/api/xstocks`,
        rule: "sha256 of the composition document equals holdingsHash, and the sum of token units × price equals perShareMicros.",
      },
      environment: "X Layer Testnet record of a model basket. Shares are bought with demo dollars that have no value; not an offer.",
      readAt: new Date(read.readAt).toISOString(),
      stale,
      readRule: "readAt is when X Layer Testnet was read: a scheduled job reads the registry every minute and this API serves that read while it is under 90 seconds old (each server instance keeps what it served for up to 30 seconds), reading X Layer itself only when it is older; when X Layer cannot be read, a read up to 10 minutes old is served with stale set to true.",
    }, 200, stale ? "public, max-age=15" : "public, max-age=30");
  } catch (error) {
    console.error("Public NAV read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    return json({ error: "The NAV record on X Layer could not be read. Try again shortly.", code: "nav_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
