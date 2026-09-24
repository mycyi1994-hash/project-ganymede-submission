export interface Env {
  DB: D1Database;
  SUBMITTER: DurableObjectNamespace;

  /** Bearer token the engine presents. Set with `wrangler secret put`. */
  RELAYER_API_TOKEN: string;
  /** Hot key holding issuer + publisher. Secret. Never the administrator key. */
  RELAYER_PRIVATE_KEY: string;

  /** `xlayer-testnet` (default) or `giwa-sepolia`. See src/chain.ts. */
  SETTLEMENT_CHAIN?: string;
  /** Overrides the chain's public RPC. */
  SETTLEMENT_RPC_URL?: string;
  FUND_SHARE_ADDRESS?: string;
  /** Product whose shares FUND_SHARE_ADDRESS holds (default core-20); other products are refused. */
  FUND_SHARE_PRODUCT_ID?: string;
  NAV_REGISTRY_ADDRESS?: string;

  /**
   * GIWA Sepolia only. Comma-separated wallets treated as Dojang-verified while
   * on testnet, where no real Upbit Korea attestation exists. Replaced by an
   * on-chain attestation read against the Dojang scroll before any mainnet use.
   */
  DOJANG_TESTNET_ALLOWLIST?: string;
}
