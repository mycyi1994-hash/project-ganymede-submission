import { engineEnv, jsonError, noStoreJson } from "@/lib/engine/api-helpers";
import { EngineRepository } from "@/lib/engine/repository";
import { SettlementClient } from "@/lib/engine/settlement";
import { constituentsWithAddresses, XSTOCKS_CHAIN, XSTOCKS_PRODUCT } from "@/lib/xstocks/basket";
import { STATE_CONFIRMED, STATE_DOCUMENT_PREFIX, STATE_HISTORY, STATE_LATEST, type LatestState, type Publication } from "@/lib/xstocks/cycle";
import { readLatestNav, type OnchainNav } from "@/lib/xstocks/onchain";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = engineEnv();
  try {
    const repo = new EngineRepository(env.DB);
    const settlement = new SettlementClient(env);
    const [latestRow, historyRow, confirmedRow] = await Promise.all([repo.getState(STATE_LATEST), repo.getState(STATE_HISTORY), repo.getState(STATE_CONFIRMED)]);
    const latest = latestRow ? JSON.parse(latestRow.value) as LatestState : null;
    const history = historyRow ? JSON.parse(historyRow.value) as Publication[] : [];
    const confirmed = confirmedRow ? JSON.parse(confirmedRow.value) as Publication : null;
    if (confirmed && !history.some((entry) => entry.holdingsHash === confirmed.holdingsHash)) history.push(confirmed);

    let onchain: OnchainNav | null = null;
    let onchainError: string | null = null;
    const registry = env.NAV_REGISTRY_ADDRESS ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(registry)) {
      try {
        onchain = await readLatestNav(settlement.rpcUrl, registry);
      } catch (error) {
        onchainError = error instanceof Error ? error.message : "On-chain read failed";
      }
    } else {
      onchainError = "NAV_REGISTRY_ADDRESS is not configured";
    }
    if (onchain?.effectiveAt && !history.some((entry) => entry.holdingsHash === onchain!.holdingsHash)) {
      const documentRow = await repo.getState(`${STATE_DOCUMENT_PREFIX}${onchain.holdingsHash}`);
      if (documentRow) history.push(JSON.parse(documentRow.value) as Publication);
    }

    return noStoreJson({
      product: {
        id: XSTOCKS_PRODUCT.id,
        ticker: XSTOCKS_PRODUCT.ticker,
        name: XSTOCKS_PRODUCT.name,
        benchmark: XSTOCKS_PRODUCT.benchmark,
        methodology: XSTOCKS_PRODUCT.methodology,
        inceptionNavMicros: XSTOCKS_PRODUCT.inceptionNavMicros.toString(),
      },
      pricing: { ...XSTOCKS_CHAIN, constituents: constituentsWithAddresses(env.XSTOCKS_ADDRESSES) },
      registry: {
        chain: settlement.chain.key,
        chainName: settlement.chain.name,
        chainId: settlement.chain.chainId,
        explorerUrl: settlement.chain.explorerUrl,
        address: registry || null,
      },
      latest,
      history,
      onchain,
      onchainError,
    });
  } catch (error) {
    return jsonError(error);
  }
}
