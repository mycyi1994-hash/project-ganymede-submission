import assert from "node:assert/strict";
import test from "node:test";
import { classifyRevert, planCall, RequestError } from "../src/contracts.ts";
import { idempotencyKey, productKey, settlementKey, toBytes32, toMicros, toUnixSeconds } from "../src/ids.ts";

const HASH = "23ab95cb6f4d59b7a12e61c8a61c960d0e1b064f0bb430c1cdb3820709c6c1c7";
const EFFECTIVE_AT = "2026-09-23T11:15:53.624Z";
const INVESTOR = "0x107633a3aa88c81d4c47d01992e089573e2e87c9";

test("publish_nav maps to publishNav on the registry with the product key", () => {
  const plan = planCall({
    entityType: "nav", entityId: `us-tech-x:${EFFECTIVE_AT}`, action: "publish_nav",
    productId: "us-tech-x", navPerShareMicros: "99999994", holdingsHash: HASH, effectiveAt: EFFECTIVE_AT,
  });
  assert.equal(plan.target, "navRegistry");
  assert.equal(plan.functionName, "publishNav");
  assert.deepEqual(plan.args, [productKey("us-tech-x"), 99999994n, 0n, `0x${HASH}`, 1790162153n]);
});

test("publish_nav without a holdings hash is rejected before any RPC call", () => {
  assert.throws(
    () => planCall({ entityType: "nav", entityId: "x", action: "publish_nav", productId: "us-tech-x", navPerShareMicros: "1", effectiveAt: EFFECTIVE_AT }),
    (error) => error instanceof RequestError && error.status === 400,
  );
});

test("mint_subscription derives its settlement id from the idempotency key, not the payload", () => {
  const request = {
    entityType: "subscription", entityId: "sub_123", action: "mint_subscription",
    productId: "core-20", walletAddress: INVESTOR, sharesMicros: "2500000", effectiveAt: EFFECTIVE_AT,
  };
  const plan = planCall(request);
  assert.equal(plan.target, "fundShare");
  assert.equal(plan.functionName, "settleSubscription");
  assert.deepEqual(plan.args, [settlementKey("subscription", "sub_123", "mint_subscription"), INVESTOR, 2500000n]);
  // A retry with a later effectiveAt lands on the same settlement id.
  const retried = planCall({ ...request, effectiveAt: "2026-09-23T12:00:00.000Z" });
  assert.equal(retried.args[0], plan.args[0]);
  assert.equal(idempotencyKey("subscription", "sub_123", "mint_subscription"), "subscription:sub_123:mint_subscription");
});

test("a mint or burn without an investor wallet is rejected", () => {
  assert.throws(
    () => planCall({ entityType: "redemption", entityId: "red_1", action: "burn_redemption", productId: "core-20", sharesMicros: "1", effectiveAt: EFFECTIVE_AT }),
    (error) => error instanceof RequestError && error.code === "invalid_wallet",
  );
});

test("reverts that mean the chain already holds the state count as settled", () => {
  for (const name of ["SettlementAlreadyProcessed", "DuplicatePayload"]) {
    assert.equal(classifyRevert(name)?.kind, "settled", name);
  }
  // A newer snapshot alone does not prove this payload landed; the submitter checks publishedPayload.
  assert.equal(classifyRevert("StalePublication")?.status, 409);
  assert.deepEqual(classifyRevert("TransferRestricted"), {
    kind: "client", status: 409, code: "investor_not_allowlisted",
    reason: "investor wallet is not allowlisted; the transfer agent must permit it first",
  });
  assert.equal(classifyRevert("Unauthorized")?.code, "role_misconfigured");
  assert.equal(classifyRevert("ContractPaused")?.status, 503);
  assert.equal(classifyRevert("SomethingElse"), null);
  assert.equal(classifyRevert(undefined), null);
});

test("identifier helpers accept the engine's formats and reject the rest", () => {
  assert.equal(toBytes32(HASH), `0x${HASH}`);
  assert.equal(toBytes32(`0x${HASH.toUpperCase()}`), `0x${HASH}`);
  assert.throws(() => toBytes32("0x1234"));
  assert.equal(toMicros("2500000", "sharesMicros"), 2500000n);
  assert.throws(() => toMicros("2.5", "sharesMicros"));
  assert.throws(() => toMicros("", "sharesMicros"));
  assert.equal(toUnixSeconds(EFFECTIVE_AT), 1790162153n);
  assert.throws(() => toUnixSeconds("not a date"));
  assert.match(productKey("core-20"), /^0x[0-9a-f]{64}$/);
  assert.notEqual(productKey("core-20"), productKey("us-tech-x"));
});
