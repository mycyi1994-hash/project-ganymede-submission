/** Keep every evidence surface at the same precision without rounding the record up. */
export function formatUsdMicros(micros: string | bigint, digits = 2): string {
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}
