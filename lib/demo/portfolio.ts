import type { DemoAccount } from "./ledger";
import type { FundPosition } from "../funds/demo";

/** Value the shared cash once and every holding once; unavailable prices never mean zero. */
export function valueDemoPortfolio(account: DemoAccount, positions: FundPosition[], navs: ReadonlyMap<string, string | null>) {
  const cashMicros = BigInt(account.cashMicros);
  let investedMicros = 0n;
  let holdingsMicros: bigint | null = 0n;
  for (const position of [{ fundId: "us-tech-x", sharesMicros: account.sharesMicros, costMicros: account.costMicros }, ...positions]) {
    const shares = BigInt(position.sharesMicros);
    investedMicros += BigInt(position.costMicros);
    if (shares === 0n) continue;
    const nav = navs.get(position.fundId);
    if (!nav || BigInt(nav) <= 0n) holdingsMicros = null;
    else if (holdingsMicros !== null) holdingsMicros += shares * BigInt(nav) / 1_000_000n;
  }
  return {
    cashMicros, investedMicros,
    totalMicros: holdingsMicros === null ? null : cashMicros + holdingsMicros,
    gainMicros: holdingsMicros === null ? null : holdingsMicros - investedMicros,
  };
}
