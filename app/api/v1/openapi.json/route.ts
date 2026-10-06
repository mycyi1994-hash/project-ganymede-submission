export const dynamic = "force-static";

const SITE = "https://ganymede-xlayer.gana003.workers.dev";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" };

const micros = { type: "string", pattern: "^-?[0-9]+$", description: "An amount in micros (6 decimals), as a string." };
const nullableMicros = { ...micros, type: ["string", "null"], description: "An amount in micros (6 decimals), as a string; null when it cannot be valued now." };
const iso = { type: "string", format: "date-time" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const readMeta = {
  readAt: { ...iso, description: "When X Layer was read for this answer." },
  stale: { type: "boolean", description: "True when X Layer could not be read and an earlier read (at most 10 minutes old) is served." },
};
const error = { type: "object", required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string" } } };

/** The public API, described for code generators and AI agents. */
export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Ganymede USTX public API",
    version: "1.0.0",
    summary: "The verified NAV of USTX, a basket of nine tokenized US tech stocks on X Layer, its pools and its market activity.",
    description: "Read-only, no key, no cookies, CORS open to every origin. Prices come from OKX OnchainOS; every NAV is recorded on X Layer Testnet (chain 1952) with a SHA-256 fingerprint of its document. Demo dollars and USTX on X Layer Testnet have no value; nothing here is an offer or investment advice. AI agents can read the same data through the MCP server at /mcp.",
  },
  servers: [{ url: SITE }],
  externalDocs: { description: "Developer guide, verification and MCP setup", url: `${SITE}/developers` },
  paths: {
    "/api/v1/ustx": {
      get: {
        operationId: "getUstxNav",
        summary: "The latest USTX NAV record",
        description: "The latest record in the NAV registry on X Layer, its validity window for orders and loans, the contracts behind USTX and how to verify the record.",
        responses: {
          200: { description: "The latest record", content: { "application/json": { schema: { type: "object", required: ["product", "nav", "record"], properties: {
            product: { type: "object", properties: { ticker: { const: "USTX" }, name: { type: "string" }, constituents: { type: "array", items: { type: "string" } } } },
            nav: { type: "object", required: ["perShareUsd", "perShareMicros", "effectiveAt", "validUntil", "usableForOrders", "holdingsHash"], properties: {
              perShareUsd: { type: "string", examples: ["99.648746"] }, perShareMicros: micros, sharesOutstandingMicros: micros,
              effectiveAt: { ...iso, description: "The time of the record's oldest price." }, calculatedAt: { type: ["string", "null"], format: "date-time" },
              validUntil: { ...iso, description: "Orders and loans accept the record until this time (one hour)." },
              usableForOrders: { type: "boolean", description: "Whether the fund and the lending market accept the record now. False while the record is over an hour old: orders wait for the next record." },
              timeRule: { type: "string" }, recordedAt: iso, holdingsHash: { type: "string", pattern: "^0x[0-9a-f]{64}$", description: "SHA-256 of the record's composition document." },
            } },
            record: { type: "object", properties: { chainId: { const: 1952 }, registry: address, transactionHash: { type: ["string", "null"] }, explorerUrl: { type: "string", format: "uri" } } },
            shares: { type: "object" }, feed: { type: "object" }, market: { type: "object" }, lending: { type: "object" }, verify: { type: "object" },
            ...readMeta,
          } } } } },
          503: { description: "X Layer could not be read and no recent read is kept", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/ustx/pools": {
      get: {
        operationId: "getUstxPools",
        summary: "The USTX/dUSD pools and their results for liquidity providers",
        description: "The constant-product pool, the Uniswap v4 pool held at the NAV and the range pool of providers' own bins: price, fee and, for the first two, reserves or holdings, value at the NAV, fee APR, last 24 hours, and what each pool's trades made or lost for its providers over the same NAV records. Values at the NAV are null while the record is over an hour old.",
        responses: {
          200: { description: "The pools", content: { "application/json": { schema: { type: "object", required: ["pools"], properties: {
            pools: { type: "array", items: { type: "object", required: ["id", "type"], properties: {
              id: { enum: ["ustx-dusd", "ustx-dusd-v4", "ustx-dusd-range"] }, type: { enum: ["constant-product", "uniswap-v4-nav-pegged", "uniswap-v4-range"] },
              address, hook: address, poolManager: address, router: address, poolId: { type: "string", pattern: "^0x[0-9a-f]{64}$" }, block: { type: "integer" },
              priceMicros: nullableMicros, navMicros: nullableMicros, valueMicros: nullableMicros, lpTokenValueMicros: nullableMicros,
              feeBps: { type: "integer", description: "The constant-product pool's fee in basis points." },
              feePips: { type: ["integer", "null"], description: "A v4 pool's swap fee now, in hundredths of a basis point." },
              tick: { type: "integer", description: "The range pool's tick." },
              navUnavailable: { type: ["string", "null"], description: "Why the range pool's NAV cannot be used now; its swaps stop meanwhile." },
              last24h: { type: ["object", "null"] }, feeApr: { type: ["object", "null"] },
              lpResult: { type: ["object", "null"], properties: { trades: { type: "integer" }, volumeMicros: micros, resultMicros: micros, arbitrages: { type: "integer" }, arbitrageResultMicros: micros, per10kYearMicros: nullableMicros, repegs: { type: "integer" } } },
            } } },
            lpResults: { type: ["object", "null"] }, rule: { type: "string" }, ...readMeta,
          } } } } },
          503: { description: "X Layer could not be read and no recent read is kept", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/ustx/activity": {
      get: {
        operationId: "getUstxActivity",
        summary: "The market's latest activity and its last 24 hours",
        description: "The latest 40 events of the USTX contracts on X Layer Testnet (orders at the fund, pool trades, the keeper's arbitrage, loans), with 24-hour figures and the arbitrages and large orders worth marking on a chart.",
        responses: {
          200: { description: "The activity", content: { "application/json": { schema: { type: "object", required: ["rows", "day"], properties: {
            fromBlock: { type: "integer" }, toBlock: { type: "integer" },
            day: { type: "object", properties: { complete: { type: "boolean" }, since: iso, trades: { type: "integer" }, volumeMicros: micros, arbitrages: { type: "integer" }, earnedMicros: micros, loans: { type: "integer" } } },
            rows: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, hash: { type: "string" }, block: { type: "integer" }, at: iso, account: address, explorerUrl: { type: "string", format: "uri" } } } },
            highlights: { type: "array", items: { type: "object" } },
          } } } } },
        },
      },
    },
    "/api/v1/funds": {
      get: {
        operationId: "getFunds",
        summary: "Every Ganymede product and its latest NAV record, or one product",
        description: "Nine products, each recorded every five minutes in the NAV registry under productKey = keccak256(id): six baskets of xStocks (USTX, M7X, AIX, CRYX, CORX, RTLX), two covered-call funds (SPYC, QQQC) and a step-down autocallable note (ELS1); kind tells them apart. With ?id=, one product with its recent records, each with its canonical document (a basket's holdings, a covered call's ETF and call, the note's levels and observations), and how a basket's prices compared with the X Layer pools; for an income product, also transitions: every record its later records rest on (each call's sale; the note's fixing, knock-in and observations) with its document and transaction, complete from transitions.since.",
        parameters: [{ name: "id", in: "query", required: false, schema: { type: "string", enum: ["us-tech-x", "magnificent-7", "ai-chips", "crypto-economy", "us-core", "retail-favorites", "spy-covered-call", "qqq-covered-call", "spy-qqq-autocall-1"] } }],
        responses: {
          200: { description: "The funds, or one fund", content: { "application/json": { schema: { type: "object", properties: {
            funds: { type: "array", items: { type: "object", properties: { id: { type: "string" }, ticker: { type: "string" }, name: { type: "string" }, productKey: { type: "string" }, kind: { type: "string", enum: ["basket", "covered-call", "autocall"] }, onchainShares: { type: "boolean", description: "Only USTX has a share token that wallets can buy." }, holdings: { type: "array", items: { type: "object" } }, nav: { type: ["object", "null"] }, changePercent: { type: ["number", "null"] }, series: { type: "array", items: { type: "array" } } } } },
            fund: { type: "object", properties: {
              history: { type: "array", items: { type: "object" }, description: "The latest twelve records, newest first, each with its canonical document and transaction." },
              transitions: { type: ["object", "null"], description: "An income product's sales, fixing, knock-in and observations, oldest first; null for a basket.", properties: {
                since: { type: "string", format: "date-time", description: "Every such record from this time on is here." },
                records: { type: "array", items: { type: "object", properties: { asOf: { type: "string", format: "date-time" }, navPerShareMicros: { type: "string" }, holdingsHash: { type: "string" }, canonical: { type: "string" }, txHash: { type: ["string", "null"] } } } },
              } },
            } },
          } } } } },
          404: { description: "No fund has that id", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/ustx/usage": {
      get: {
        operationId: "getUstxUsage",
        summary: "Usage since launch, the team's wallets apart",
        description: "Every event of the USTX fund, both pools and the lending market on X Layer Testnet since launch: wallets outside the team's list, their actions and demo-dollar volume, the team's and test wallets' actions, actions by kind, and questions asked of Ask USTX.",
        responses: {
          200: { description: "The usage", content: { "application/json": { schema: { type: "object", required: ["outside", "team"], properties: {
            fromBlock: { type: "integer" }, toBlock: { type: "integer" }, since: { type: ["string", "null"], format: "date-time" },
            outside: { type: "object", properties: { wallets: { type: "integer" }, activeLast7Days: { type: "integer" }, actions: { type: "integer" }, volumeMicros: micros } },
            team: { type: "object", properties: { wallets: { type: "integer" }, actions: { type: "integer" }, volumeMicros: micros } },
            kinds: { type: "object", additionalProperties: { type: "object", properties: { all: { type: "integer" }, outside: { type: "integer" } } } },
            askUstx: { type: "object", properties: { questions: { type: "integer" }, since: { type: "string", format: "date" } } },
            teamWallets: { type: "object", additionalProperties: { type: "string" } },
            rule: { type: "string" },
          } } } } },
          503: { description: "Not read yet", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/ustx/dex-quotes": {
      get: {
        operationId: "getDexQuotes",
        summary: "Building the basket by hand: OKX DEX aggregator quotes on X Layer mainnet",
        description: "Once an hour, an OKX OnchainOS DEX aggregator quote for each of the nine xStocks, paying an equal share of $1,000 in USDT on X Layer mainnet, and the total: swaps, what they buy at the aggregator's prices, network fees and the largest price impact. Quotes only; nothing is sent.",
        responses: {
          200: { description: "The quotes", content: { "application/json": { schema: { type: "object", required: ["at", "legs", "total"], properties: {
            at: iso, basketUsd: { type: "number" }, error: { type: "string" },
            legs: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, paidMicros: micros, receivedMicros: { type: ["string", "null"] }, priceImpactPercent: { type: ["string", "null"] }, networkFeeUsd: { type: ["string", "null"] }, routes: { type: "array", items: { type: "string" } } } } },
            total: { type: "object", properties: { swaps: { type: "integer" }, paidMicros: micros, receivedMicros: { type: ["string", "null"] }, costMicros: { type: ["string", "null"] }, networkFeeUsd: { type: ["number", "null"] }, maxPriceImpactPercent: { type: ["number", "null"] } } },
            rule: { type: "string" },
          } } } } },
          503: { description: "Not read yet", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/mcp": {
      post: {
        operationId: "mcp",
        summary: "Model Context Protocol (Streamable HTTP, JSON responses)",
        description: "JSON-RPC 2.0: initialize, ping, tools/list and tools/call. Tools: get_ustx_nav, verify_ustx_nav, get_ustx_holdings, quote_ustx_order, get_ustx_pools, get_ustx_market_activity, list_funds, get_fund. All read only.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["jsonrpc", "method"], properties: { jsonrpc: { const: "2.0" }, id: { type: ["string", "integer"] }, method: { type: "string" }, params: { type: "object" } } },
          examples: { quote: { value: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "quote_ustx_order", arguments: { side: "buy", amount: 500 } } } } } } } },
        responses: { 200: { description: "A JSON-RPC response" }, 202: { description: "Notifications accepted" } },
      },
    },
  },
} as const;

export function GET() {
  return new Response(JSON.stringify(OPENAPI, null, 2), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
