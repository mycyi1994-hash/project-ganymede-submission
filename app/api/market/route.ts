import { engineEnv, jsonError, noStoreJson } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const currentEnv = engineEnv();
  const repo = new EngineRepository(currentEnv.DB);
  try {
    return noStoreJson(await repo.marketOverview());
  } catch (error) {
    return jsonError(error);
  }
}
