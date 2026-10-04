/**
 * The test OKB drip: enough X Layer Testnet gas for about a hundred transactions, once per wallet,
 * so a first visitor can invest without finding a faucet first. Test OKB has no value.
 */
export const FAUCET_TERMS = {
  /** 0.0005 test OKB. */
  dripWei: 500_000_000_000_000n,
  /** Wallets holding less than 0.0001 test OKB can ask for a drip. */
  lowWei: 100_000_000_000_000n,
  perVisitorPerDay: 3,
  perSitePerDay: 50,
} as const;

export const formatOkb = (wei: bigint) => `${(Number(wei / 1_000_000_000_000n) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })} test OKB`;
