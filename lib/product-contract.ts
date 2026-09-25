/** Customer-facing contract for the next transaction integration, not a trading API. */
export type TransactionStage = "review" | "wallet" | "submitted" | "funding" | "execution" | "settled" | "payout" | "completed" | "rejected" | "recovery";
export type ProductCapability = {
  productId: "us-tech-x";
  environment: "testnet";
  canSubscribe: false;
  canRedeem: false;
  settlementAsset: null;
  custodyAddress: null;
  reason: string;
};

// Real-money subscriptions stay closed. Testnet orders with demo dollars (lib/xstocks/fund.ts,
// lib/demo/) are not funded investments. Replace this capability only when a backend can return
// authenticated executable terms for real money.
export const USTX_CAPABILITY: ProductCapability = {
  productId: "us-tech-x", environment: "testnet", canSubscribe: false, canRedeem: false,
  settlementAsset: null, custodyAddress: null,
  reason: "Subscriptions and redemptions are not open for this basket.",
};

export type ExecutableQuote = {
  id: string; accountId: string; productId: string; chainId: number;
  side: "subscribe" | "redeem"; inputAsset: string; inputUnits: string;
  outputAsset: string; expectedOutputUnits: string; minimumOutputUnits: string;
  feeUnits: string; feeAsset: string; expiresAt: string; destination: string;
};

export type ProductTransaction = {
  id: string; accountId: string; productId: string; quoteId: string;
  side: "subscribe" | "redeem"; stage: TransactionStage; updatedAt: string;
  inputUnits: string; outputUnits: string | null; txHashes: string[];
  canRetry: boolean; requiresAction: boolean; recoveryMessage: string | null;
};
