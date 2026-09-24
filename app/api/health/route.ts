import { engineEnv, jsonError, noStoreJson } from "@/lib/engine/api-helpers";
import { SettlementClient } from "@/lib/engine/settlement";
import { EngineRepository } from "@/lib/engine/repository";
import { UpbitExecutionClient } from "@/lib/engine/upbit";

export const dynamic = "force-dynamic";

export async function GET() {
  const currentEnv = engineEnv();
  try {
    const repo = new EngineRepository(currentEnv.DB);
    const [upbit, settlement, database] = await Promise.all([
      new UpbitExecutionClient(currentEnv).health(),
      new SettlementClient(currentEnv).health(),
      repo.operationsStatus(),
    ]);
    const ready = Boolean(database) && upbit.configured && settlement.connected;
    return noStoreJson({ ready, mode: currentEnv.TRADING_MODE === "live" ? "live" : "paper", upbit, settlement, database: { connected: true, lastCycleAt: database.lastCycleAt ?? null } }, { status: ready ? 200 : 503 });
  } catch (error) {
    return jsonError(error, 503);
  }
}
