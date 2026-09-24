import { engineEnv, jsonError, noStoreJson, operatorIdentity, readJson } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";

export const dynamic = "force-dynamic";

type OperationAction =
  | { action: "set_kyc"; investorId: string; status: "unverified" | "pending" | "verified" | "expired" | "blocked" }
  | { action: "confirm_funding"; subscriptionId: string }
  | { action: "approve_redemption"; redemptionId: string }
  | { action: "set_product_status"; productId: string; status: "operational" | "paused" | "closed" };

export async function POST(request: Request) {
  const actor = await operatorIdentity(request);
  if (!actor) return noStoreJson({ error: "Operator authorization required" }, { status: 401 });
  try {
    const payload = await readJson<OperationAction>(request);
    const repo = new EngineRepository(engineEnv().DB);
    await repo.seed();
    if (payload.action === "set_kyc") {
      await repo.setInvestorKyc(payload.investorId, payload.status, actor);
    } else if (payload.action === "confirm_funding") {
      await repo.db.prepare("UPDATE subscriptions SET status = 'executing' WHERE id = ? AND status = 'funding'").bind(payload.subscriptionId).run();
      await repo.audit("subscription.funding_confirmed", "subscription", payload.subscriptionId, actor, {});
    } else if (payload.action === "approve_redemption") {
      await repo.db.prepare("UPDATE redemptions SET status = 'executing' WHERE id = ? AND status = 'locked'").bind(payload.redemptionId).run();
      await repo.audit("redemption.approved", "redemption", payload.redemptionId, actor, {});
    } else if (payload.action === "set_product_status") {
      await repo.db.prepare("UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.status, payload.productId).run();
      await repo.audit("product.status_changed", "product", payload.productId, actor, { status: payload.status });
    } else {
      return noStoreJson({ error: "Unknown operation action" }, { status: 400 });
    }
    return noStoreJson({ ok: true, actor, action: payload.action });
  } catch (error) {
    return jsonError(error, 400);
  }
}
