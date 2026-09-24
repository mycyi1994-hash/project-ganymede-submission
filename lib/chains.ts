/**
 * Settlement rails, shared by the engine and the browser wallet UI. Mirrors
 * relayer/src/chain.ts — keep the two in step.
 *
 * Both are test networks. Neither is proof of custody, licensing or a venue
 * relationship.
 */
export type SettlementChain = {
  key: "xlayer-testnet" | "giwa-sepolia";
  chainId: number;
  name: string;
  /** Upper-case label for badges. */
  label: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
};

export const SETTLEMENT_CHAINS: Record<SettlementChain["key"], SettlementChain> = {
  "xlayer-testnet": {
    key: "xlayer-testnet",
    chainId: 1952,
    name: "X Layer Testnet",
    label: "X LAYER TESTNET",
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  },
  "giwa-sepolia": {
    key: "giwa-sepolia",
    chainId: 91342,
    name: "GIWA Sepolia",
    label: "GIWA SEPOLIA",
    rpcUrl: "https://sepolia-rpc.giwa.io",
    explorerUrl: "https://sepolia-explorer.giwa.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

/** The rail the investor UI presents. The engine follows SETTLEMENT_CHAIN. */
export const DEFAULT_SETTLEMENT_CHAIN = SETTLEMENT_CHAINS["xlayer-testnet"];

export function resolveSettlementChain(key: string | undefined): SettlementChain {
  if (!key) return DEFAULT_SETTLEMENT_CHAIN;
  const chain = SETTLEMENT_CHAINS[key as SettlementChain["key"]];
  if (!chain) throw new Error(`Unknown SETTLEMENT_CHAIN "${key}". Expected one of: ${Object.keys(SETTLEMENT_CHAINS).join(", ")}`);
  return chain;
}
