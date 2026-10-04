# Static analysis and fuzzing of the contracts

The contracts in `contracts/` are not audited. This file records what an automated pass found and
why each High and Medium finding does or does not need a change. Run it again with:

```bash
pip install slither-analyzer && solc-select install 0.8.28 && solc-select use 0.8.28
cd onchain && npm run analyze   # scripts/slither.sh: one report per contract in onchain/slither/
```

## Slither 0.11.6, 2 October 2026

Every contract in `contracts/`, compiled with solc 0.8.28 as Hardhat builds them (optimizer, 200
runs), Uniswap v4-core's own code left out: 135 findings.

| Impact | Detector | Count | Outcome |
| --- | --- | --- | --- |
| High | reentrancy-balance | 3 | False positive: guarded |
| Medium | reentrancy-no-eth | 12 | False positive: guarded, trusted callee |
| Medium | unused-return | 23 | Intended |
| Medium | incorrect-equality | 13 | Intended |
| Medium | divide-before-multiply | 11 | Intended rounding |
| Medium | uninitialized-local | 2 | Intended |
| Low | reentrancy-events, reentrancy-benign, timestamp, calls-loop | 60 | Reviewed, no change |
| Informational, Optimization | assembly, low-level-calls, naming, digits, inheritance, array length | 11 | No change |

**reentrancy-balance (High, 3), `GanymedeBasketVault.create`.** The vault reads each token's balance,
pulls the token with `transferFrom`, and requires the balance to have risen by what is owed. Slither
flags that a token calling back into `create` during the transfer could be counted twice. `create`
and `redeem` both carry the contract's `nonReentrant` guard, which Slither does not model, so the
callback reverts. The vault is not deployed; it runs only on a fork (`npm run fork:vault`).

**reentrancy-no-eth (Medium, 12), `GanymedeRwaLiquidityHook` and the vault.** State written after
calls to the pool manager in `_deposit`, `_withdraw`, `_repeg`, `_remove`. Every external entry point
of the hook (`deposit`, `cancelDeposit`, `claimShares`, `withdraw`, `repeg`) is `nonReentrant`, the
pool manager's callbacks (`beforeSwap`, `afterSwap`, `beforeAddLiquidity`, `beforeInitialize`) accept
only the pool manager, and the only other calls are `transferFrom` on USTX and dUSD, which have no
hooks. Uniswap's pool manager itself locks between `unlock` and settlement.

**unused-return (Medium, 23).** Tuple fields left unread on purpose: the registry's and the feed's
records (only the NAV and its time are used), `getSlot0` (only price and tick), `modifyLiquidity`'s
fee delta, `settle()`'s amount (the balance check is the pool manager's). None of them carries an
error that is dropped; the calls revert on failure.

**incorrect-equality (Medium, 13).** Comparisons with zero (`debt == 0`, `last == 0`, `burned == 0`,
`elapsed == 0`) and one exact-division check in the vault. None compares a balance an attacker can
nudge to a value it must equal.

**divide-before-multiply (Medium, 11).** Rounding chosen on purpose and in the protocol's favour:
- The lending market rounds repayments and interest down, and seizes collateral for the amount
  actually repaid.
- `GanymedeNavArbitrage.quote` approximates the trade size with an integer square root. The trade
  runs against the pool and reverts unless it earns its minimum, so the approximation can only cost
  the arbitrageur some of the gap.
- The hook's `_center` rounds the NAV tick to the spacing and corrects truncation toward zero for
  negative ticks (`if (tick < center) center -= TICK_SPACING`).
- The constant-product pool's `addLiquidity` takes the smaller side.

**uninitialized-local (Medium, 2).** `fees0` and `fees1` in `_collectFees` start at zero and add
each range's fees; zero is the intended start.

No finding led to a change in the contracts.

## Invariant fuzzing

`onchain/test/GanymedeRwaLiquidityHook.test.ts` runs two randomised runs against Uniswap's compiled
PoolManager, each seed deterministic so a failure replays:

- **The books** (140 steps of deposits, cancellations, trades both ways, records within ±2%, re-pegs
  and withdrawals). After every step:
  - the hook's claims at the pool manager equal its idle balances and cover the waiting deposits;
  - the waiting deposits add up;
  - claimable shares are held by the hook;
  - every holder could withdraw at once.

  At the end everyone leaves and less than 10 cents stays.
- **The providers against trades at the NAV** (3 seeds × 40 steps by default; `HOOK_FUZZ_SEEDS=10
  HOOK_FUZZ_STEPS=100` ran 1,000 steps on 2 October 2026 and passed). NAV records up to 3% either
  way, re-pegs, deposits and orders of up to about 4% of the pool. Since each record:
  - what the providers own, valued at that NAV, has not fallen beyond 2,000 micros of rounding;
  - what the app counts for them (`lib/xstocks/lp-markout.ts`) adds up to no loss;
  - for every trade, the app's count equals what the trader gave up at the NAV, to 2 micros.

  Between records the pool trades like any concentrated-liquidity pool, so a trade that reverses
  an earlier one can show a loss on its own; liquidity is worth least at the NAV when the pool's
  price is at the NAV, which the hook moves it to at each record, so the trades since a record can
  only add to what the providers own.

What this does not cover: a formal verification, a third-party audit, or trades made before a NAV
record lands by someone who knows it (see docs/UNISWAP_V4_LIQUIDITY.md, "What this does not cover").

## Lending market fuzzing, 3 October 2026

`onchain/test/GanymedeLendingMarket.test.ts` drives the market with random lending, withdrawals,
collateral, borrowing (sometimes past the limit), repayment, liquidation, NAV moves from 15% down to 9%
up, time jumps of up to two weeks and administrator pauses. After every step it checks that each
account's principal and collateral add up to the market's totals, that the market holds every USTX
posted, and that the dUSD it holds and is owed covers what it owes its lenders; that no borrow or
collateral withdrawal leaves a loan past its limit; that only loans past the liquidation threshold are
liquidated, at most half at a time, and every such loan can be; and that a pause never stops an exit. At
the end every borrower repays and every lender withdraws in full, leaving only the market's reserves. A
run of 10 seeds × 200 steps (`LENDING_FUZZ_SEEDS=10 LENDING_FUZZ_STEPS=200`) passed with 74 loans, 8
liquidations and 98 repayments among 2,000 steps.
