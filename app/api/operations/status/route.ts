import { engineEnv, jsonError, noStoreJson, operatorIdentity } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await operatorIdentity(request);
  if (!actor) return noStoreJson({ error: "Operator authorization required" }, { status: 401 });
  try {
    const repo = new EngineRepository(engineEnv().DB);
    return noStoreJson({ actor, ...(await repo.operationsStatus()) });
  } catch (error) {
    return jsonError(error);
  }
}
