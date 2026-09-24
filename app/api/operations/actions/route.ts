import { engineEnv, jsonError, noStoreJson, operatorIdentity, readJson } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";

export const dynamic = "force-dynamic";

const KYC_STATUSES = ["unverified", "pending", "verified", "expired", "blocked"] as const;
const PRODUCT_STATUSES = ["operational", "paused", "closed"] as const;

type OperationAction =
  | { action: "set_kyc"; investorId: string; status: (typeof KYC_STATUSES)[number] }
  | { action: "confirm_funding"; subscriptionId: string }
  | { action: "approve_redemption"; redemptionId: string }
  | { action: "set_product_status"; productId: string; status: (typeof PRODUCT_STATUSES)[number] };

const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

export async function POST(request: Request) {
  const actor = await operatorIdentity(request);
  if (!actor) return noStoreJson({ error: "Operator authorization required" }, { status: 401 });
  try {
    const payload = await readJson<OperationAction>(request);
    const repo = new EngineRepository(engineEnv().DB);
    await repo.seed();
    let changed = false;
    if (payload?.action === "set_kyc") {
      if (!isId(payload.investorId) || !KYC_STATUSES.includes(payload.status)) return noStoreJson({ error: "investorId and a valid KYC status are required" }, { status: 400 });
      changed = await repo.setInvestorKyc(payload.investorId, payload.status, actor);
    } else if (payload?.action === "confirm_funding") {
      if (!isId(payload.subscriptionId)) return noStoreJson({ error: "subscriptionId is required" }, { status: 400 });
      const result = await repo.db.prepare("UPDATE subscriptions SET status = 'executing' WHERE id = ? AND status = 'funding'").bind(payload.subscriptionId).run();
      changed = Number(result.meta?.changes ?? 0) > 0;
      if (changed) await repo.audit("subscription.funding_confirmed", "subscription", payload.subscriptionId, actor, {});
    } else if (payload?.action === "approve_redemption") {
      if (!isId(payload.redemptionId)) return noStoreJson({ error: "redemptionId is required" }, { status: 400 });
      const result = await repo.db.prepare("UPDATE redemptions SET status = 'executing' WHERE id = ? AND status = 'locked'").bind(payload.redemptionId).run();
      changed = Number(result.meta?.changes ?? 0) > 0;
      if (changed) await repo.audit("redemption.approved", "redemption", payload.redemptionId, actor, {});
    } else if (payload?.action === "set_product_status") {
      if (!isId(payload.productId) || !PRODUCT_STATUSES.includes(payload.status)) return noStoreJson({ error: "productId and a valid product status are required" }, { status: 400 });
      const result = await repo.db.prepare("UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.status, payload.productId).run();
      changed = Number(result.meta?.changes ?? 0) > 0;
      if (changed) await repo.audit("product.status_changed", "product", payload.productId, actor, { status: payload.status });
    } else {
      return noStoreJson({ error: "Unknown operation action" }, { status: 400 });
    }
    // Nothing matched (unknown id or not in the required state): no success and no audit row.
    if (!changed) return noStoreJson({ error: "No record in the required state was found", action: payload.action }, { status: 404 });
    return noStoreJson({ ok: true, actor, action: payload.action });
  } catch (error) {
    return jsonError(error, 400);
  }
}
