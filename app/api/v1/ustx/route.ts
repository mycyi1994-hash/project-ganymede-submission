import { engineEnv } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { SettlementClient } from "@/lib/engine/settlement";
import { POOL_FACTORY, POOL_FEE, POOL_TOLERANCE, XSTOCK_POOLS } from "@/lib/xstocks/pool-prices";
import { XSTOCKS_CHAIN, XSTOCKS_PRODUCT } from "@/lib/xstocks/basket";
import { STATE_CONFIRMED, STATE_HISTORY, type Publication } from "@/lib/xstocks/cycle";
import { readLatestNav } from "@/lib/xstocks/onchain";
import { FUND_DEPLOYMENT } from "@/lib/xstocks/fund";
import { ledger, walletTotals } from "@/lib/demo/api";

export const dynamic = "force-dynamic";

// Any site or app may read this: a public record, no cookies, no credentials.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

function json(value: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}

/** GanymedeBasketFund.MAX_NAV_AGE: orders and loans use a record for one hour after its time. */
const NAV_VALIDITY_MS = 3_600_000;
const usd = (micros: string) => `${BigInt(micros) / 1_000_000n}.${(BigInt(micros) % 1_000_000n).toString().padStart(6, "0")}`;

/** The latest USTX NAV record, read from the registry on X Layer at request time. Reads only. */
export async function GET(request: Request) {
  const env = engineEnv();
  const origin = new URL(request.url).origin;
  const registry = env.NAV_REGISTRY_ADDRESS ?? "";
  const settlement = new SettlementClient(env);
  try {
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry)) throw new Error("The NAV registry is not configured.");
    const record = await readLatestNav(settlement.rpcUrl, registry, { chainId: settlement.chain.chainId });
    if (!record.effectiveAt) throw new Error("No NAV has been recorded yet.");
    // The transaction hash is a convenience from this server's log; the record itself came from the chain.
    let transactionHash: string | null = null;
    let calculatedAt: string | null = null;
    try {
      const repo = new EngineRepository(env.DB);
      const [history, confirmed] = await Promise.all([repo.getState(STATE_HISTORY), repo.getState(STATE_CONFIRMED)]);
      const entries = [...(history ? JSON.parse(history.value) as Publication[] : []), ...(confirmed ? [JSON.parse(confirmed.value) as Publication] : [])];
      const match = entries.find(entry => entry.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof entry.txHash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.txHash));
      transactionHash = match?.txHash ?? null;
      const entry = entries.find(item => item.holdingsHash.toLowerCase() === record.holdingsHash.toLowerCase() && typeof item.calculatedAt === "string");
      calculatedAt = entry?.calculatedAt ?? null;
    } catch { /* The record stands without it. */ }
    // The count recorded with the NAV covers two kinds of shares; each part is read now, and a part that
    // cannot be read is null rather than a guess.
    const [demo, wallets] = await Promise.all([ledger().fund(new Date()).catch(() => null), walletTotals().catch(() => null)]);
    return json({
      product: { id: XSTOCKS_PRODUCT.id, ticker: "USTX", name: "US Tech Basket", constituents: ["AAPLx", "MSFTx", "NVDAx", "AMZNx", "METAx", "TSLAx"] },
      nav: {
        perShareUsd: usd(record.navPerShareMicros),
        perShareMicros: record.navPerShareMicros,
        sharesOutstandingMicros: record.sharesOutstandingMicros,
        effectiveAt: record.effectiveAt,
        calculatedAt,
        validUntil: new Date(Date.parse(record.effectiveAt) + NAV_VALIDITY_MS).toISOString(),
        timeRule: "effectiveAt is the time of the record's oldest price, never later than calculatedAt. The fund and the lending market accept the NAV until validUntil, one hour after effectiveAt.",
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
          inDemoBalancesMicros: demo?.sharesOutstandingMicros ?? null,
          rule: "The NAV record counts both kinds of shares. Shares in wallets are this token: they trade in the pool and serve as loan collateral. Shares in demo balances stay in the Ganymede app and issue nothing on chain. The two parts are read now; the recorded count is as of the NAV.",
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
    }, 200, "public, max-age=30");
  } catch (error) {
    console.error("Public NAV read failed", (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]"));
    return json({ error: "The NAV record on X Layer could not be read. Try again shortly.", code: "nav_unavailable" }, 503, "no-store");
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
