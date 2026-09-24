import { defineChain, type Chain } from "viem";

/**
 * Settlement rails the relayer can sign for. Both are test networks: neither is
 * proof of custody, licensing or a venue relationship.
 *
 * X Layer testnet is the default rail. GIWA Sepolia stays selectable so an
 * existing GIWA deployment keeps working with `SETTLEMENT_CHAIN=giwa-sepolia`.
 */
export const xlayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" } },
  testnet: true,
});

export const giwaSepolia = defineChain({
  id: 91342,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rpc.giwa.io"] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: "https://sepolia-explorer.giwa.io" } },
  testnet: true,
});

export const SETTLEMENT_CHAINS = {
  "xlayer-testnet": xlayerTestnet,
  "giwa-sepolia": giwaSepolia,
} as const satisfies Record<string, Chain>;

export type SettlementChainKey = keyof typeof SETTLEMENT_CHAINS;

export const DEFAULT_SETTLEMENT_CHAIN: SettlementChainKey = "xlayer-testnet";

export function settlementChain(key: string | undefined): { key: SettlementChainKey; chain: Chain } {
  const resolved = (key || DEFAULT_SETTLEMENT_CHAIN) as SettlementChainKey;
  const chain = SETTLEMENT_CHAINS[resolved];
  if (!chain) {
    throw new Error(`Unknown SETTLEMENT_CHAIN "${key}". Expected one of: ${Object.keys(SETTLEMENT_CHAINS).join(", ")}`);
  }
  return { key: resolved, chain };
}
