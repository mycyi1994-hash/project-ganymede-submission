/**
 * A portable evidence file for one published USTX record: the exact document bytes, the
 * record the browser read from X Layer and the transaction that published it. Anyone can
 * re-run the checks with `npm run verify:evidence -- <file>`, including after the record
 * is no longer the latest, because the transaction receipt carries the NavPublished event.
 */
import { PROOF_DEPLOYMENT, type Check } from "./proof";
import { layeredChecks } from "./proof-experiment";
import { XSTOCKS_PRODUCT } from "./basket";
import { readLatestNav, XSTOCKS_PRODUCT_KEY, type OnchainNav } from "./onchain";

/** keccak256("NavPublished(bytes32,uint256,uint256,bytes32,uint64)"); equals topic0 of the registry's logs on X Layer Testnet. */
export const NAV_PUBLISHED_TOPIC = "0x7473313be7106e5141b2da10837d77c93ad5b7e1fa646edaaafcb7493432298b";
export const EVIDENCE_KIND = "ganymede-nav-evidence";

export type EvidenceBundle = {
  kind: typeof EVIDENCE_KIND;
  version: 1;
  generatedAt: string;
  product: { id: string; ticker: string; key: string };
  network: { name: string; chainId: number; registry: string; rpcUrl: string; explorerUrl: string };
  record: { navPerShareMicros: string; holdingsHash: string; effectiveAt: string; transactionHash: string | null };
  document: string;
  browserChecks: { chainRead: Check["state"]; fingerprint: Check["state"]; recalculatedNav: Check["state"] };
  verify: string[];
  scope: string;
};

export function buildEvidence(input: { record: OnchainNav; document: string; transactionHash: string | null; checks: { chain: Check; hash: Check; nav: Check }; now: Date }): EvidenceBundle {
  if (!input.record.effectiveAt) throw new Error("The record has no effective time.");
  return {
    kind: EVIDENCE_KIND,
    version: 1,
    generatedAt: input.now.toISOString(),
    product: { id: XSTOCKS_PRODUCT.id, ticker: XSTOCKS_PRODUCT.ticker, key: XSTOCKS_PRODUCT_KEY },
    network: { name: "X Layer Testnet", chainId: PROOF_DEPLOYMENT.chainId, registry: PROOF_DEPLOYMENT.registry, rpcUrl: PROOF_DEPLOYMENT.rpcUrl, explorerUrl: PROOF_DEPLOYMENT.explorerUrl },
    record: { navPerShareMicros: input.record.navPerShareMicros, holdingsHash: input.record.holdingsHash, effectiveAt: input.record.effectiveAt, transactionHash: input.transactionHash && /^0x[0-9a-f]{64}$/i.test(input.transactionHash) ? input.transactionHash : null },
    document: input.document,
    browserChecks: { chainRead: input.checks.chain.state, fingerprint: input.checks.hash.state, recalculatedNav: input.checks.nav.state },
    verify: [
      "npm run verify:evidence -- <this file>   (from a checkout of the repository)",
      "SHA-256 of the UTF-8 bytes of `document` must equal record.holdingsHash.",
      "For each holding, floor(unitsWad × priceMicros / 10^18) must equal valueMicros, and the values must sum to navPerShareMicros.",
      "The transaction receipt on X Layer Testnet must contain a NavPublished event from the registry with this product key, fingerprint, NAV and time.",
    ],
    scope: "Consistency of one published document, its arithmetic and its X Layer record. It does not show that the prices are accurate, that any asset is held, or that the NAV can be traded or redeemed.",
  };
}

const text = (value: unknown): value is string => typeof value === "string";
const hex32 = (value: unknown): value is string => text(value) && /^0x[0-9a-f]{64}$/i.test(value);

export function parseEvidence(value: unknown): EvidenceBundle {
  const bundle = value as EvidenceBundle;
  if (!bundle || typeof bundle !== "object" || bundle.kind !== EVIDENCE_KIND || bundle.version !== 1) throw new Error("This is not a Ganymede evidence file.");
  if (!bundle.record || !text(bundle.record.navPerShareMicros) || !/^\d+$/.test(bundle.record.navPerShareMicros) || !hex32(bundle.record.holdingsHash) || !text(bundle.record.effectiveAt) || !Number.isFinite(Date.parse(bundle.record.effectiveAt))) throw new Error("The evidence file has an incomplete record.");
  if (bundle.record.transactionHash !== null && !hex32(bundle.record.transactionHash)) throw new Error("The evidence file has an invalid transaction hash.");
  if (!text(bundle.document) || !bundle.network || !bundle.product) throw new Error("The evidence file is missing its document, network or product.");
  return bundle;
}

export type NavPublishedEvent = { productKey: string; holdingsHash: string; navPerShareMicros: string; sharesOutstandingMicros: string; effectiveAt: string };

export function decodeNavPublished(log: { topics: string[]; data: string }): NavPublishedEvent | null {
  if (log.topics.length !== 3 || log.topics[0].toLowerCase() !== NAV_PUBLISHED_TOPIC) return null;
  const data = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
  if (data.length !== 64 * 3 || !/^[0-9a-f]+$/i.test(data)) return null;
  const word = (index: number) => BigInt(`0x${data.slice(index * 64, (index + 1) * 64)}`);
  return { productKey: log.topics[1].toLowerCase(), holdingsHash: log.topics[2].toLowerCase(), navPerShareMicros: word(0).toString(), sharesOutstandingMicros: word(1).toString(), effectiveAt: new Date(Number(word(2)) * 1000).toISOString() };
}

export type EvidenceResult = { label: string; state: "pass" | "fail" | "skip"; detail: string };
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

function rpcClient(url: string, fetcher: typeof fetch): Rpc {
  return async (method, params) => {
    const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error !== undefined) throw new Error(`RPC error for ${method}`);
    return payload.result;
  };
}

const sameSecond = (a: string, b: string) => Math.floor(Date.parse(a) / 1000) === Math.floor(Date.parse(b) / 1000);

/** Checks an evidence file against the verifier's own pinned deployment, never against values the file supplies. */
export async function verifyEvidence(bundle: EvidenceBundle, options: { offline?: boolean; rpcUrl?: string; fetcher?: typeof fetch } = {}): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const pinned = bundle.network.chainId === PROOF_DEPLOYMENT.chainId && bundle.network.registry.toLowerCase() === PROOF_DEPLOYMENT.registry && bundle.product.key.toLowerCase() === XSTOCKS_PRODUCT_KEY;
  results.push(pinned
    ? { label: "Deployment", state: "pass", detail: `The file names the pinned USTX registry ${PROOF_DEPLOYMENT.registry} on chain ${PROOF_DEPLOYMENT.chainId}.` }
    : { label: "Deployment", state: "fail", detail: "The file names a different network, registry or product than this verifier pins." });
  const record: OnchainNav = { navPerShareMicros: bundle.record.navPerShareMicros, sharesOutstandingMicros: "0", holdingsHash: bundle.record.holdingsHash, effectiveAt: bundle.record.effectiveAt, publishedAt: null };
  const layers = await layeredChecks(bundle.document, record);
  const asResult = (label: string, check: Check): EvidenceResult => ({ label, state: check.state === "pass" ? "pass" : "fail", detail: check.detail });
  results.push(asResult("Fingerprint", layers.fingerprint), asResult("Row arithmetic", layers.arithmetic), asResult("Record NAV and time", layers.record));
  if (options.offline) {
    results.push({ label: "X Layer record", state: "skip", detail: "Skipped (--offline). The file's record was not compared with the chain." });
    return results;
  }
  const rpc = rpcClient(options.rpcUrl ?? PROOF_DEPLOYMENT.rpcUrl, options.fetcher ?? fetch);
  try {
    const chainId = await rpc("eth_chainId", []);
    if (typeof chainId !== "string" || BigInt(chainId) !== BigInt(PROOF_DEPLOYMENT.chainId)) {
      results.push({ label: "X Layer record", state: "fail", detail: "The RPC is not X Layer Testnet (1952)." });
      return results;
    }
    if (bundle.record.transactionHash) {
      const receipt = await rpc("eth_getTransactionReceipt", [bundle.record.transactionHash]) as { status?: string; logs?: { address: string; topics: string[]; data: string }[] } | null;
      if (!receipt || receipt.status !== "0x1") {
        results.push({ label: "X Layer record", state: "fail", detail: "The transaction was not found or did not succeed." });
        return results;
      }
      const events = (receipt.logs ?? []).filter(log => log.address.toLowerCase() === PROOF_DEPLOYMENT.registry).map(decodeNavPublished).filter((event): event is NavPublishedEvent => event !== null && event.productKey === XSTOCKS_PRODUCT_KEY);
      const match = events.find(event => event.holdingsHash === bundle.record.holdingsHash.toLowerCase());
      results.push(match && match.navPerShareMicros === bundle.record.navPerShareMicros && sameSecond(match.effectiveAt, bundle.record.effectiveAt)
        ? { label: "X Layer record", state: "pass", detail: `Transaction ${bundle.record.transactionHash.slice(0, 10)}… emitted NavPublished from the pinned registry with this fingerprint, NAV and time.` }
        : { label: "X Layer record", state: "fail", detail: "The transaction has no NavPublished event from the pinned registry that matches this fingerprint, NAV and time." });
      return results;
    }
    const latest = await readLatestNav(options.rpcUrl ?? PROOF_DEPLOYMENT.rpcUrl, PROOF_DEPLOYMENT.registry, { chainId: PROOF_DEPLOYMENT.chainId, fetcher: options.fetcher });
    const same = latest.holdingsHash.toLowerCase() === bundle.record.holdingsHash.toLowerCase() && latest.navPerShareMicros === bundle.record.navPerShareMicros && Boolean(latest.effectiveAt) && sameSecond(latest.effectiveAt!, bundle.record.effectiveAt);
    results.push(same
      ? { label: "X Layer record", state: "pass", detail: "The registry's latest record equals the file's record." }
      : { label: "X Layer record", state: "skip", detail: "The file has no transaction hash and its record is no longer the latest, so it could not be compared with the chain." });
  } catch (error) {
    results.push({ label: "X Layer record", state: "fail", detail: error instanceof Error ? `The chain could not be read: ${error.message}` : "The chain could not be read." });
  }
  return results;
}
