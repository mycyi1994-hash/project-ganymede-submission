/**
 * The Ganymede funds. Each is a basket of xStocks on X Layer mainnet, priced by OKX OnchainOS every
 * five minutes and recorded under its own product key in the same NAV registry on X Layer Testnet.
 * USTX also has its share token, pools and lending market; the others are bought with a demo
 * balance. Every token is pinned here and checked on chain to be the same xStocks proxy and
 * implementation as AAPLx (4 October 2026).
 */
import { XSTOCKS_CONSTITUENTS, XSTOCKS_PINNED_ADDRESSES, XSTOCKS_PRODUCT } from "../xstocks/basket";

export type UniverseToken = { symbol: string; name: string; underlying: string; address: string; kind: "stock" | "etf" };

/** The 18 xStocks the funds hold, in display order. */
export const XSTOCK_UNIVERSE: UniverseToken[] = [
  ...XSTOCKS_CONSTITUENTS.map((item) => ({ symbol: item.symbol, name: item.name, underlying: item.underlying, address: XSTOCKS_PINNED_ADDRESSES[item.symbol], kind: "stock" as const })),
  { symbol: "AMDx", name: "AMD", underlying: "AMD", address: "0x3522513e5f146a2006e2901b05f16b2821485e19", kind: "stock" },
  { symbol: "INTCx", name: "Intel", underlying: "INTC", address: "0xf8a80d1cb9cfd70d03d655d9df42339846f3b3c8", kind: "stock" },
  { symbol: "COINx", name: "Coinbase", underlying: "COIN", address: "0x364f210f430ec2448fc68a49203040f6124096f0", kind: "stock" },
  { symbol: "MSTRx", name: "Strategy", underlying: "MSTR", address: "0xae2f842ef90c0d5213259ab82639d5bbf649b08e", kind: "stock" },
  { symbol: "CRCLx", name: "Circle", underlying: "CRCL", address: "0xfebded1b0986a8ee107f5ab1a1c5a813491deceb", kind: "stock" },
  { symbol: "HOODx", name: "Robinhood", underlying: "HOOD", address: "0xe1385fdd5ffb10081cd52c56584f25efa9084015", kind: "stock" },
  { symbol: "GMEx", name: "GameStop", underlying: "GME", address: "0xe5f6d3b2405abdfe6f660e63202b25d23763160d", kind: "stock" },
  { symbol: "SPYx", name: "S&P 500 ETF", underlying: "SPY", address: "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48", kind: "etf" },
  { symbol: "QQQx", name: "Nasdaq-100 ETF", underlying: "QQQ", address: "0xa753a7395cae905cd615da0b82a53e0560f250af", kind: "etf" },
];

export const universeToken = (symbol: string) => XSTOCK_UNIVERSE.find((token) => token.symbol === symbol);

export type FundDefinition = {
  id: string;
  ticker: string;
  name: string;
  /** One line for lists. */
  theme: string;
  description: string;
  constituents: string[];
  /** USTX is the fund with a share token on X Layer Testnet, pools and lending. */
  onchainShares: boolean;
  href: string;
  /** keccak256 of the id: the fund's key in GanymedeNavRegistry (relayer/src/ids.ts productKey). */
  productKey: string;
};

/** Computed with viem's keccak256(stringToBytes(id)); tests/funds.test.mjs recomputes them. */
const PRODUCT_KEYS: Record<string, string> = {
  "us-tech-x": "0x7fd4bda948705c478ec63926a4cdececd33422c85c3e35f414251992b48c2a20",
  "magnificent-7": "0x3c2564524f1d6275c4b775472243490283c0635b97c14324d0f5e3213e6e3ea3",
  "ai-chips": "0xfc464356a6d7e333f221af6d544a49d7d4a0715076af7900974f32b9052a70d3",
  "crypto-economy": "0x4e6342701e7fc0f540e0ef516de9e0df89c7cd7bfcf517ba00e6d58acf2d61a3",
  "us-core": "0x1ecb5fdd48a9eee3b0d5dfa3edd8d88d3aaba7e042c19f2d5da1ca0f3934a873",
  "retail-favorites": "0xd11e1c918a3d8ee917ceb26e7abe032b870699c20d19ece5d4a68428cc40b25e",
};

export const USTX_FUND: FundDefinition = {
  id: XSTOCKS_PRODUCT.id, ticker: "USTX", name: "US Tech Basket", theme: "Nine US technology leaders",
  description: "Equal weight in nine US technology leaders. Invest from OKX Wallet or a demo balance, trade it in two pools and borrow against it.",
  constituents: XSTOCKS_CONSTITUENTS.map((item) => item.symbol), onchainShares: true, href: "/products/ustx", productKey: PRODUCT_KEYS[XSTOCKS_PRODUCT.id],
};

const fund = (id: string, ticker: string, name: string, theme: string, description: string, constituents: string[]): FundDefinition =>
  ({ id, ticker, name, theme, description, constituents, onchainShares: false, href: `/funds/${id}`, productKey: PRODUCT_KEYS[id] });

/** The other five, bought with a demo balance. */
export const OTHER_FUNDS: FundDefinition[] = [
  fund("magnificent-7", "M7X", "Magnificent 7", "The seven largest US tech companies",
    "Equal weight in Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla and Alphabet.", ["AAPLx", "MSFTx", "NVDAx", "AMZNx", "METAx", "TSLAx", "GOOGLx"]),
  fund("ai-chips", "AIX", "AI & Semiconductors", "The chips and platforms behind AI",
    "Equal weight in the chip makers NVIDIA, AMD and Intel and the AI platforms of Microsoft, Alphabet, Meta, Oracle and Palantir.", ["NVDAx", "AMDx", "INTCx", "MSFTx", "GOOGLx", "METAx", "ORCLx", "PLTRx"]),
  fund("crypto-economy", "CRYX", "Crypto Economy", "US-listed companies built on crypto",
    "Equal weight in Coinbase, Strategy, Circle and Robinhood: an exchange, a bitcoin treasury, a stablecoin issuer and a retail broker.", ["COINx", "MSTRx", "CRCLx", "HOODx"]),
  fund("us-core", "CORX", "US Core Index", "The S&P 500 and the Nasdaq-100",
    "Half in the S&P 500 and half in the Nasdaq-100, through their ETF xStocks: the broad US market in one share.", ["SPYx", "QQQx"]),
  fund("retail-favorites", "RTLX", "Retail Favorites", "The names retail investors trade most",
    "Equal weight in GameStop, Robinhood, Tesla, Palantir, Coinbase and AMD.", ["GMEx", "HOODx", "TSLAx", "PLTRx", "COINx", "AMDx"]),
];

export const FUNDS: FundDefinition[] = [USTX_FUND, ...OTHER_FUNDS];
export const otherFund = (id: string) => OTHER_FUNDS.find((item) => item.id === id) ?? null;

/** NAV per share at each new fund's first fixing: US$100. */
export const FUND_INCEPTION_NAV_MICROS = 100_000_000n;

/** The constituents of a fund with their pinned addresses. */
export function fundConstituents(definition: FundDefinition) {
  return definition.constituents.map((symbol) => {
    const token = universeToken(symbol);
    if (!token) throw new Error(`${symbol} is not in the xStock universe`);
    return { symbol, underlying: token.underlying, name: token.name, address: token.address };
  });
}
