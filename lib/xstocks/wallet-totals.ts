/**
 * USTX held in wallets on X Layer Testnet and the number of wallets holding it, as the fund contract
 * reports them: what the fund overview, the public NAV API and each NAV record count.
 */
import { engineEnv } from "../engine/api-helpers";
import { fundRpc, parseStoredWalletTotals, readFundTotals, STATE_WALLET_SHARES, type StoredWalletTotals } from "./fund";

export type WalletTotals = { sharesMicros: string; investors: number; block: number };
let walletCache: { at: number; value: WalletTotals } | null = null;

/**
 * Read from the fund contract (cached for 30 seconds per isolate). If the chain cannot be read, the
 * value the last NAV cycle stored; otherwise null. Reads only.
 */
export async function walletTotals(now = Date.now()): Promise<WalletTotals | null> {
  if (walletCache && now - walletCache.at < 30_000) return walletCache.value;
  try {
    const totals = await readFundTotals({ rpc: fundRpc({ signal: AbortSignal.timeout(6_000) }) });
    walletCache = { at: now, value: { sharesMicros: totals.sharesMicros.toString(), investors: totals.investors, block: totals.block } };
    return walletCache.value;
  } catch {
    try {
      const row = await engineEnv().DB.prepare("SELECT value FROM engine_state WHERE key = ?").bind(STATE_WALLET_SHARES).first<{ value: string }>();
      const stored: StoredWalletTotals | null = parseStoredWalletTotals(row?.value);
      return stored ? { sharesMicros: stored.sharesMicros, investors: stored.investors, block: stored.block } : null;
    } catch { return null; }
  }
}
