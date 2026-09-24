import { engineEnv, jsonError, noStoreJson, operatorIdentity, readJson } from "@/lib/engine/api-helpers";
import { runEngineCycle } from "@/lib/engine/runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await operatorIdentity(request);
  if (!actor) return noStoreJson({ error: "Operator authorization required" }, { status: 401 });
  try {
    const payload = await readJson<{ force?: boolean }>(request);
    const result = await runEngineCycle(engineEnv(), "operator", { force: payload.force === true });
    return noStoreJson({ actor, result });
  } catch (error) {
    return jsonError(error);
  }
}
