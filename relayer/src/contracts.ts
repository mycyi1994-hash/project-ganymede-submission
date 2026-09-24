/**
 * Minimal ABIs for the two settlement contracts, plus the mapping from an
 * engine settlement action to a concrete contract call.
 *
 * The custom errors are declared here on purpose: viem needs them to decode a
 * revert into a name, and the relayer's whole retry/idempotency behaviour keys
 * off those names.
 */
import type { Address } from "viem";
import { productKey, settlementKey, toBytes32, toMicros, toUnixSeconds } from "./ids";

export const FUND_SHARE_ABI = [
  {
    type: "function",
    name: "settleSubscription",
    stateMutability: "nonpayable",
    inputs: [
      { name: "settlementId", type: "bytes32" },
      { name: "investor", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleRedemption",
    stateMutability: "nonpayable",
    inputs: [
      { name: "settlementId", type: "bytes32" },
      { name: "investor", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setInvestorPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "investor", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "issuer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "isAllowed",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "processedSettlement",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "InvalidAddress", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "TransferRestricted", inputs: [] },
  { type: "error", name: "ContractPaused", inputs: [] },
  { type: "error", name: "SettlementAlreadyProcessed", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "InsufficientAllowance", inputs: [] },
] as const;

export const NAV_REGISTRY_ABI = [
  { type: "function", name: "publishedPayload", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "publishNav",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "bytes32" },
      { name: "navPerShareMicros", type: "uint256" },
      { name: "sharesOutstandingMicros", type: "uint256" },
      { name: "holdingsHash", type: "bytes32" },
      { name: "effectiveAt", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "publishRebalance",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "bytes32" },
      { name: "rebalanceHash", type: "bytes32" },
      { name: "effectiveAt", type: "uint64" },
    ],
    outputs: [],
  },
  { type: "function", name: "publisher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "latestNav",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "navPerShareMicros", type: "uint256" },
      { name: "sharesOutstandingMicros", type: "uint256" },
      { name: "holdingsHash", type: "bytes32" },
      { name: "effectiveAt", type: "uint64" },
      { name: "publishedAt", type: "uint64" },
    ],
  },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "InvalidAddress", inputs: [] },
  { type: "error", name: "InvalidPayload", inputs: [] },
  { type: "error", name: "StalePublication", inputs: [] },
  { type: "error", name: "DuplicatePayload", inputs: [] },
  { type: "error", name: "ContractPaused", inputs: [] },
] as const;

/** The settlement request the engine POSTs (lib/engine/settlement.ts). */
export interface SettlementRequest {
  entityType: "nav" | "subscription" | "redemption" | "rebalance";
  entityId: string;
  action: "publish_nav" | "mint_subscription" | "burn_redemption" | "publish_rebalance";
  productId: string;
  walletAddress?: string | null;
  amount?: string;
  navPerShareMicros?: string;
  sharesOutstandingMicros?: string;
  sharesMicros?: string;
  holdingsHash?: string;
  effectiveAt: string;
  payloadHash?: string;
}

export interface PlannedCall {
  target: "fundShare" | "navRegistry";
  abi: typeof FUND_SHARE_ABI | typeof NAV_REGISTRY_ABI;
  functionName: string;
  args: readonly unknown[];
}

export class RequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_request") {
    super(message);
  }
}

function investorAddress(request: SettlementRequest): Address {
  const address = request.walletAddress ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new RequestError(`walletAddress is required for ${request.action}`, 400, "invalid_wallet");
  }
  return address as Address;
}

/**
 * Translates one engine settlement request into the contract call it means.
 *
 * Notes on two deliberate mappings:
 *  - publish_rebalance uses the engine's holdingsHash as the rebalance evidence
 *    hash. That hash is the post-rebalance holdings digest, which is exactly the
 *    evidence the registry is meant to anchor.
 *  - publish_nav falls back to 0 shares outstanding when the engine does not
 *    send the field. The registry only rejects a zero NAV, not zero shares, and
 *    a wrong non-zero number would be worse than an explicit zero.
 */
export function planCall(request: SettlementRequest): PlannedCall {
  const effectiveAt = toUnixSeconds(request.effectiveAt);

  switch (request.action) {
    case "mint_subscription":
      return {
        target: "fundShare",
        abi: FUND_SHARE_ABI,
        functionName: "settleSubscription",
        args: [
          settlementKey(request.entityType, request.entityId, request.action),
          investorAddress(request),
          toMicros(request.sharesMicros, "sharesMicros"),
        ],
      };

    case "burn_redemption":
      return {
        target: "fundShare",
        abi: FUND_SHARE_ABI,
        functionName: "settleRedemption",
        args: [
          settlementKey(request.entityType, request.entityId, request.action),
          investorAddress(request),
          toMicros(request.sharesMicros, "sharesMicros"),
        ],
      };

    case "publish_nav": {
      if (!request.holdingsHash) throw new RequestError("holdingsHash is required for publish_nav");
      return {
        target: "navRegistry",
        abi: NAV_REGISTRY_ABI,
        functionName: "publishNav",
        args: [
          productKey(request.productId),
          toMicros(request.navPerShareMicros, "navPerShareMicros"),
          request.sharesOutstandingMicros
            ? toMicros(request.sharesOutstandingMicros, "sharesOutstandingMicros")
            : 0n,
          toBytes32(request.holdingsHash),
          effectiveAt,
        ],
      };
    }

    case "publish_rebalance": {
      if (!request.holdingsHash) throw new RequestError("holdingsHash is required for publish_rebalance");
      return {
        target: "navRegistry",
        abi: NAV_REGISTRY_ABI,
        functionName: "publishRebalance",
        args: [productKey(request.productId), toBytes32(request.holdingsHash), effectiveAt],
      };
    }

    default:
      throw new RequestError(`unsupported action "${(request as SettlementRequest).action}"`, 400, "unsupported_action");
  }
}

/**
 * How each contract revert should be treated.
 *
 * "settled" means the chain already holds the state this request wanted. That is
 * a success for an idempotent relayer, not a failure — returning an error would
 * make the engine retry forever against a guard that will never let it through.
 */
export type RevertDisposition =
  | { kind: "settled"; reason: string }
  | { kind: "client"; status: number; code: string; reason: string }
  | { kind: "operational"; status: number; code: string; reason: string };

export function classifyRevert(errorName: string | undefined): RevertDisposition | null {
  switch (errorName) {
    case "SettlementAlreadyProcessed":
      return { kind: "settled", reason: "settlement id already consumed on chain" };
    case "DuplicatePayload":
      return { kind: "settled", reason: "identical payload already published" };
    case "StalePublication":
      return { kind: "client", status: 409, code: "stale_publication", reason: "An equal or newer snapshot exists; this does not prove the requested payload was published." };
    case "TransferRestricted":
      return {
        kind: "client",
        status: 409,
        code: "investor_not_allowlisted",
        reason: "investor wallet is not allowlisted; the transfer agent must permit it first",
      };
    case "InvalidAmount":
    case "InvalidAddress":
    case "InvalidPayload":
      return { kind: "client", status: 400, code: "invalid_payload", reason: `contract rejected the payload (${errorName})` };
    case "InsufficientBalance":
      return { kind: "client", status: 409, code: "insufficient_shares", reason: "investor does not hold enough shares" };
    case "ContractPaused":
      return { kind: "operational", status: 503, code: "contract_paused", reason: "contract is paused by the administrator" };
    case "Unauthorized":
      return {
        kind: "operational",
        status: 500,
        code: "role_misconfigured",
        reason: "relayer key does not hold the issuer/publisher role on this contract",
      };
    default:
      return null;
  }
}
