/** Display-only estimates; the server prices the saved paper allocation. The bounds match createSubscription. */
export function estimatePaperAllocation(amountKrw: string, navMicros: string | undefined, fee: string) {
  const amount = Number(amountKrw);
  const amountError = !amountKrw
    ? "Enter a sample amount to continue."
    : !/^\d+$/.test(amountKrw) || !Number.isSafeInteger(amount)
      ? "Enter a whole KRW amount within the supported range."
      : amount < 100_000 ? "Enter at least ₩100,000 to continue."
        : amount > 1_000_000_000 ? "Enter at most ₩1,000,000,000 to continue." : "";
  const nav = Number(navMicros) / 1_000_000;
  const hasNav = Number.isFinite(nav) && nav > 0;
  const feeRate = Number.parseFloat(fee) / 100;
  return {
    amountError,
    shares: !amountError && hasNav ? amount / nav : null,
    annualFeeKrw: !amountError && Number.isFinite(feeRate) ? Math.round(amount * feeRate) : null,
  };
}
