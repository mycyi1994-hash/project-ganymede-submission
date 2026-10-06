/** Display helpers for share amounts on the product screens. Shares use six decimals, like the NAV. */
const SHARE = 1_000_000n;

/** Fired on window, with its block, after a wallet transaction (an order, a loan step or a pool action) is mined, so figures on the page refresh. */
export const DEMO_ORDER_EVENT = "ganymede:demo-order";

export function formatShares(micros: string | bigint): string {
  const value = BigInt(micros);
  const whole = value / SHARE;
  return `${whole.toLocaleString("en-US")}.${(value % SHARE).toString().padStart(6, "0")}`;
}

/** Up to six decimals, like the share ledger. */
export function parseShares(input: string): bigint | null {
  const text = input.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SHARE + BigInt(fraction.padEnd(6, "0"));
}

/** A share count shortened for headlines: 1,234.56 rather than 1,234.560000. */
export function formatSharesShort(micros: string | bigint, digits = 2): string {
  const value = BigInt(micros);
  const whole = value / SHARE;
  const fraction = (value % SHARE).toString().padStart(6, "0").slice(0, digits);
  return digits > 0 ? `${whole.toLocaleString("en-US")}.${fraction}` : whole.toLocaleString("en-US");
}
