/**
 * Canonical mapping between the engine's string identifiers and the bytes32
 * identifiers the settlement contracts expect.
 *
 * Shared by the relayer and the on-chain tooling. Both sides MUST derive
 * identifiers here — a divergence between them silently breaks the idempotency
 * guarantees that stop a subscription being minted twice.
 */
import { keccak256, stringToBytes, type Hex } from "viem";

/** Engine product id ("core-20") -> bytes32 key used by GanymedeNavRegistry. */
export function productKey(productId: string): Hex {
  if (!productId) throw new Error("productId is required");
  return keccak256(stringToBytes(productId));
}

/**
 * bytes32 settlement id used by GanymedeFundShare.processedSettlement.
 *
 * Derived from `entityType:entityId:action` — the exact string the engine
 * already sends as its Idempotency-Key (lib/engine/settlement.ts). That makes an app
 * retry, a relayer retry and a queue redelivery all collapse onto one id, so
 * the contract's own `SettlementAlreadyProcessed` guard is the final backstop.
 *
 * Deliberately NOT derived from the request payload hash: the payload carries
 * `effectiveAt`, which changes between retries of the same logical settlement.
 * Keying on it would produce a fresh id per retry and mint the same
 * subscription more than once.
 */
export function settlementKey(entityType: string, entityId: string, action: string): Hex {
  if (!entityType || !entityId || !action) {
    throw new Error("entityType, entityId and action are all required to derive a settlement id");
  }
  return keccak256(stringToBytes(`${entityType}:${entityId}:${action}`));
}

/** The engine's Idempotency-Key format, kept in one place. */
export function idempotencyKey(entityType: string, entityId: string, action: string): string {
  return `${entityType}:${entityId}:${action}`;
}

/**
 * The engine emits holdings hashes as bare sha256 hex. The contracts take
 * bytes32. Accepts either form and rejects anything that is not 32 bytes.
 */
export function toBytes32(hash: string): Hex {
  const normalized = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`expected a 32-byte hex hash, received "${hash}"`);
  }
  return `0x${normalized.toLowerCase()}` as Hex;
}

/** ISO-8601 -> uint64 unix seconds, as the contracts store effectiveAt. */
export function toUnixSeconds(iso: string): bigint {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`invalid ISO-8601 timestamp: "${iso}"`);
  const seconds = Math.floor(ms / 1000);
  if (seconds <= 0) throw new Error(`timestamp out of range: "${iso}"`);
  return BigInt(seconds);
}

/** Integer-string micros -> uint256. Rejects the float forms the engine never emits. */
export function toMicros(value: string | undefined | null, field: string): bigint {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${field} is required`);
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an unsigned integer string, received "${value}"`);
  }
  return BigInt(value);
}
