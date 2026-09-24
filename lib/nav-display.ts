/** Keep every evidence surface at the same precision without rounding the record up. */
export function formatUsdMicros(micros: string | bigint, digits = 2): string {
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}

/** For account and fund figures: to the nearest cent, so a $1,000 order reads $1,000.00, not $999.99. */
export function formatUsdRounded(micros: string | bigint): string {
  const value = BigInt(micros);
  if (value < 0n) return `−${formatUsdRounded(-value)}`;
  return formatUsdMicros((value + 5_000n) / 10_000n * 10_000n, 2);
}
