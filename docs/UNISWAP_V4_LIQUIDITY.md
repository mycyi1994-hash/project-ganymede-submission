# USTX liquidity on Uniswap v4

USTX has a fair price that is not discovered in any pool: the NAV recorded every five minutes from
the xStocks' prices. `GanymedeUstxPool`, the constant-product market, moves only when someone trades
in it, so every NAV record leaves its price behind, and the first trade after a record, often the
arbitrage keeper's, buys from or sells to its liquidity providers at the old price. That loss grows
with the square of the NAV's move and is the main cost of providing liquidity to a tokenized asset.

`contracts/GanymedeRwaLiquidityHook.sol` is a Uniswap v4 hook that runs a USTX/dUSD pool around the
NAV instead, and is the vault of the liquidity providers who fund it. It is written for any ERC-20
asset with a price feed in Chainlink's `AggregatorV3Interface`; on X Layer Testnet that is USTX with
`GanymedeNavFeed`. It is tested on a local v4 pool manager and on a fork of X Layer Testnet, and it
runs on X Layer Testnet (see "Deployment on X Layer Testnet" below).

## How it works

**One pool, owned liquidity.** The hook opens its pool in its constructor: USTX and dUSD sorted by
address, a dynamic fee, tick spacing 10, at the price the NAV gives. The pool manager does not call a
hook back for the hook's own calls, and the hook refuses every other pool (`beforeInitialize`) and all
liquidity it does not add itself (`beforeAddLiquidity`). So the hook is the pool's only liquidity
provider, and it issues ERC-20 shares (`USTX-V4LP`, 6 decimals) to the people who fund it.

**Deposits are priced forward.** The first deposit takes both tokens in full, needs a fresh NAV,
mints their value at the NAV in dollar units, less 1,000 shares locked for good, and opens the
ranges; it must be worth at least $10. Every later deposit is priced the way a fund prices
subscriptions, at the first NAV published after it: it names the most of each token it will pay,
takes them at the ratio the hook holds the two tokens, and waits as an ERC-6909 claim in the pool
manager. The re-peg to that record values the waiting deposits and everything the shares already own
at that NAV, mints the deposits' shares in that proportion (rounded down) and puts the tokens to
work. The depositor then claims the shares (`claimShares`, or the next `deposit` or `withdraw` does
it) and can cancel before, getting exactly the deposit back. If a fresh record has landed that the
pool has not re-pegged to yet, the deposit applies it first, so it cannot become liquidity at once,
just ahead of a swap its depositor can already see. A deposit therefore earns nothing from trades
made before its liquidity is in the pool: without this, a deposit made just before a known trade and
withdrawn just after would take a pro-rata part of that trade's fee and spread while its tokens sat
idle. A withdrawal pays the shares' part of the ranges and of the idle claims, fees included, rounded
down, at any time and with any NAV, stale or missing.

**Ranges.** The liquidity sits in two ranges. The base range covers 200 ticks (about 2%) on each side
of the NAV and is as large as the holdings allow; whichever token it cannot use goes into a one-sided
range 300 ticks wide next to the NAV, on the side where that token sells. After buyers have taken USTX
the pool is long dollars, which then bid for USTX just below the NAV; after sellers it is long USTX,
offered just above it. Deep liquidity at the NAV and inventory that leans back toward balance are what
a market maker in a tokenized fund aims for.

**Re-peg.** At each new NAV record, before the first swap that follows it (or when anyone calls
`repeg()`), the hook takes both ranges out, fees included, turns the waiting deposits into shares,
moves the pool's price to the new NAV and puts everything back around it. With the hook's liquidity
out the pool is empty, and moving the price of an empty pool exchanges nothing: the same tokens go
back in around the new price. The liquidity providers keep the value they had at the new NAV, less a
few base units of rounding, instead of selling the difference to an arbitrageur.

**Fee and limits.** Between records the pool trades on Uniswap's concentrated-liquidity curve. The
fee is 0.30% with a fresh NAV and rises linearly to 1.00% at an hour, because an older NAV is a less
certain price. Past an hour swaps stop, as the fund's orders and the lending market's loans do, until
a new record arrives. A record may carry a time up to a minute past its block, the clock tolerance
Ganymede's evidence checks allow, and counts as fresh; one dated further ahead is refused, since it
would not age, and deposits wait for it too: taken while it is out, a deposit would convert at it once
the clock caught up, at a record its depositor could already see. No swap may leave the price more than 500 ticks (about 5%) from the NAV. The hook has no owner, no pause and
nothing to configure.

**Around it.** `contracts/GanymedeV4Router.sol` swaps on a v4 pool where no Uniswap router serves it:
exact input with a minimum output or exact output with a maximum input, a deadline, and quotes that
run the same swap and revert with the result (call them with `eth_call`). A swap that fills less than
asked reverts. The pool manager reads a hook's permissions from the low 14 bits of its address, so the
hook is deployed with CREATE2 through the deterministic deployment proxy
(`0x4e59b44847b379578588920ca78fbf26c0b4956c`, present on X Layer Testnet) at a salt mined for
exactly its four permissions (`onchain/scripts/_v4.ts`).

**Pool manager.** Uniswap has deployed v4 on X Layer mainnet, with its PoolManager at
[`0x360e68faccca8ca495c1b759fd9eee466db9fb32`](https://web3.okx.com/explorer/x-layer/address/0x360e68faccca8ca495c1b759fd9eee466db9fb32),
but not on X Layer Testnet. The tests and scripts deploy the PoolManager from `@uniswap/v4-core`
1.0.2 as Uniswap built it (solc 0.8.26, via IR, Cancun). `npm run fork:v4` first checks that this is
the code running at Uniswap's X Layer mainnet address, apart from the one immutable that holds the
contract's own address. X Layer Testnet runs the Cancun opcodes the pool manager needs (`TSTORE`,
`MCOPY`, `PUSH0`).

## What the tests show

`onchain/test/GanymedeRwaLiquidityHook.test.ts`, 23 tests on the canonical pool manager with the
real fund, demo dollar, NAV registry and NAV feed contracts:

- the pool opens at the NAV, the hook's address carries its permissions, and no one else can open a
  pool with the hook, add liquidity to its pool or call its callbacks;
- NAVs from $0.0001 to $1,000,000,000 a share map to exactly the pool price computed off chain, with
  USTX as either of the pool's two currencies;
- the first deposit mints its value at the NAV and centres the ranges on it; a later deposit takes its
  tokens at the holdings' ratio, waits without changing the ranges or what the shares own, and at the
  next record becomes shares worth its value at that NAV;
- a deposit that applies a newer record itself is sized against the shares that record minted, as
  after a separate `repeg()`, even with the pool emptied down to its locked shares; a maximum of
  `type(uint256).max` lets the other token decide;
- **a deposit made just before a $2,000 trade gets none of that trade's gain**: cancelled, it returns
  exactly; left to convert, it is priced after the trade, and its shares are worth what it put in;
  made after a record has landed, it re-pegs to that record first and waits for the next, so calling
  `repeg()` cannot convert it ahead of the trade;
- withdrawals match `previewWithdraw` exactly, include fees, leave waiting deposits alone and work
  with a stale NAV;
- the fee is 0.30% plus the NAV's age (0.65% at half an hour, 1.00% at an hour) and swaps stop after
  an hour; a record 45 seconds ahead of its block trades at 0.30%, one 30 days ahead stops swaps
  and deposits while withdrawals continue; a buy and a sell back leave the providers about 0.3% of each leg
  richer;
- **with the NAV recorded 5% higher, an arbitrageur takes $2.689195 from $10,000 in the
  constant-product pool, exactly what its providers lose, while the hooked pool re-pegs with a zero
  swap and its providers lose less than a tenth of a cent**; afterwards buying USTX in the hooked pool
  and redeeming it at the fund loses money;
- the limit that remains: buying $1,500 of USTX at the old NAV before a record 2% higher lands, then
  redeeming it at the fund, still takes $20.69 from the providers;
- swaps that would take the price more than 5% from the NAV revert; what the base range cannot use is
  placed on the side where it sells, in both token orders;
- with USTX as the pool's second currency (negative ticks), and with a $1.00 NAV that lands exactly on
  tick 0, where the pool manager leaves its tick at -1 after moving down onto it, the books still
  balance;
- a seeded random run of 140 steps (24 deposits, 4 cancellations, 11 withdrawals, 34 trades, NAV
  records and 17 re-pegs with 10 conversions) checks after each one that the hook's ERC-6909 claims
  equal its idle balances and cover the waiting deposits, that the waiting deposits add up, and that
  every holder could withdraw; at the end everyone does, and less than ten cents stays behind;
- donations to the pool reach the providers; tokens sent to the hook directly are ignored;
- the router fills exact input and exact output within the trader's limits, and refuses a partial fill.

The tests deploy through the same routine as the scripts (`deployRwaLiquidity` in
`onchain/scripts/_v4.ts`). The existing contracts, deployed ones included, compile to the same
bytecode as before.

## The fork run on 1 October 2026

`npm run fork:v4` (in `onchain/`) forks X Layer Testnet into memory, deploys the pool manager, the
hook (against the live USTX fund, dUSD and `GanymedeNavFeed`) and the router, and walks one cycle with
local test accounts. It uses no key and broadcasts nothing.

```text
Uniswap's PoolManager on X Layer mainnet (0x360e68faccca8ca495c1b759fd9eee466db9fb32) runs the same code as the one deployed below, apart from its own address
forked X Layer Testnet at block 42393808 (in memory only)

live USTX NAV $98.588184 from 0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8, recorded 142 s before the fork's latest block

deploying on the fork...
  deploy PoolManager         0x9dc93854096a120623c90ac429fa9d340d6c3132fd24908ee32f9b14e924bc67  gas 5243607
  hook address 0x73Ff416063CD69EEd92c4c1068E16742801Ba8C0 (salt 0x0000000000000000000000000000000000000000000000000000000000000584)
  deploy hook (CREATE2)      0x5153a2479df2a91a07b7f026bb4d7416ebf0bcb4fe725c7c738b29da24541cd3  gas 5548493
  deploy GanymedeV4Router    0xfaaf01b12014bdc1b607339b2777f511afb5e1248261773c0551928ddad09489  gas 1031183
pool 0xe08bd102ebd58d2465234820c4e5073c89c605cd5b2071a4564fb6e63ca4a473: USTX is currency0, opened at $98.5882

provider bought 50.716016 USTX for $5,000 at the fund and deposited it with $5,000: 9999.998917 LP shares
  base range $96.6186 to $100.6621 around the NAV; holdings worth $9,999.999816 at the NAV

trader bought 10.087855 USTX for $1,000 ($99.129101 each, fee 0.3404%); pool price now $98.9956
trader sold half of it back; pool price $98.7923
second provider deposited 16.599323 USTX and $2,000.00 at the pool's ratio; it waits for the next NAV record

publisher (impersonated) records a NAV 1% higher: $99.574065
  live constant-product pool price $98.642714, -0.93% from the new NAV
  an arbitrage bought its USTX below the NAV and redeemed it at the fund for $0.051161; its providers ($10,000.208575 at the new NAV) lost $0.051161
  hooked pool: the next swap moved it to the new NAV before trading; price after the $10 swap $99.5774
  the first provider's shares at the new NAV: $10,050.639803 before, $10,050.662112 after (with their part of the $10 swap's fee)
  the waiting deposit, worth $3,652.862067 at the new NAV, became 3634.456837 shares

provider withdrew 45.598648 USTX and $5,510.219373: $10,050.662112 at the new NAV (holding the deposit instead: $10,049.999873)
second provider claimed its shares and withdrew 16.572633 USTX and $2,002.665663: $3,652.870098 at the new NAV

gas used
  deploy PoolManager   5,243,607
  deploy hook          5,548,493
  deploy router        1,031,183
  first deposit        600,728
  swap                 185,386
  swap                 163,471
  later deposit        416,065
  swap that re-pegs    667,881
  withdraw             329,340
  claim and withdraw   241,511

Nothing was broadcast; the fork is discarded when this process exits.
```

The live constant-product pool sat 0.06% above the old NAV, inside its 0.3% fee, so a 1% record
opened only a small arbitrage there; the tests' 5% record shows the difference more plainly. The
first provider in the hooked pool ended $0.66 ahead of holding the deposit, from the trader's fees.
The second provider's deposit waited through the trades and became shares at the new NAV, which it
withdrew for what it was worth then plus its part of the last swap's fee.

## Deploying

`npm run deploy:v4` (in `onchain/`) deploys on X Layer Testnet with `ADMIN_PRIVATE_KEY`: the pool
manager, owned by the administrator, whose only power over it is to appoint who may switch on
Uniswap's protocol fee (at most 0.1% of a swap); the hook; and the router. Each transaction carries
its own nonce and gas limit. The script then seeds the pool from the administrator wallet (claim
10,000 dUSD, invest $5,000 at the fund, deposit the USTX with $5,000), reads the wiring back at the
seeding block and records the three addresses, the CREATE2 salt and the pool ID in
`deployments/xlayer-testnet.json`. Deploying needs the user's approval. After deploying,
`npm run verify:export` includes the hook and the router, and a keeper can call `repeg()` after each
NAV record so traders do not pay for it.

## In the app

The Pools screen (`app/product-ui/Pools.tsx`) runs the live constant-product pool and shows this
pool beside it from `V4_POOL_DEPLOYMENT` in `lib/xstocks/v4-liquidity.ts`, pinned to the testnet
deployment; with the constant `null`, nothing of the v4 pool appears. `npm run deploy:v4` prints the
pin after it records the deployment, and `onchain/test/AppV4Client.test.ts` fails if the pin and the
record disagree. With it, the pool list gains a row for this pool (its current fee, value at the NAV
and the wallet's position), and choosing it shows:

- the value held, the swap fee now, the NAV record and its age, the deposits waiting for the next
  record, and where the liquidity sits (the main and one-sided ranges in dollars per USTX);
- a panel that deposits USTX and demo dollars at the ratio of what the pool holds, shows a deposit
  waiting for the next record with a countdown and a Cancel button, offers **Convert now** once a
  newer record is out (one `repeg()` and a claim, so a depositor does not wait for the next trade),
  claims converted LP tokens and withdraws at any time, with 1% minimums.

`lib/xstocks/v4-liquidity.ts` reads the hook at one block (`totalAmounts`, `pendingOf`,
`claimableShares`, `nav`, `currentFee`, both ranges, and the pool's slot0 through the pool manager's
`extsload` at the state slot pinned with the deployment, since the app carries no keccak), quotes
deposits with the hook's own `_sharesFor` arithmetic, reads results back from the hook's events and
unwraps a hook's revert from the pool manager's `WrappedError`. `onchain/test/AppV4Client.test.ts`
sends the app's own calldata to a local pool manager and hook: the first deposit, a later one that
waits, a cancellation, a re-peg at a new record, the claim, withdrawals within four micros of the
app's estimate, a stale record and a swap's wrapped revert.

On 1 October 2026 the whole screen ran in a browser against a Hardhat fork of X Layer Testnet, with
this pool deployed and seeded on the fork and pinned in a local build only: on the live pool, a
dUSD-only deposit (five transactions), a withdrawal redeemed at the NAV, a withdrawal in both tokens
and a paired deposit; on this pool, a deposit, a NAV record 1% higher, Convert now (19.779085 LP
tokens at $99.8843), a withdrawal of half, and a second deposit cancelled. Portfolio then showed the
live pool's position.

## Deployment on X Layer Testnet

On 1 October 2026, with the user's approval, `npm run deploy:v4` deployed the contracts from the
administrator `0x107633a3aa88c81d4c47d01992e089573e2e87c9` (after `npm run fork:v4` ran the same
routine on a fork) and seeded the pool at the NAV of $97.835757: it claimed 10,000 dUSD, invested
$5,000 at the fund and deposited the USTX it issued with $5,000.

| Contract | Address | Transaction |
| --- | --- | --- |
| Uniswap v4 PoolManager (owner: administrator) | `0xe83eee508ce92832488dd9f574ad329a1203641c` | `0x0d28b64ef87bcb5c5abe5d928cef585623368f302986a0dab89b2c96972ad82e` |
| `GanymedeRwaLiquidityHook` (CREATE2, salt `0xcf`) | `0x96a78af00ef351f294f2ccc05adf09b119f968c0` | `0xb630d206b2f76216db5e8dc7f7c98286b6e07a51730c57e28319ee8f9d4b4259` |
| `GanymedeV4Router` | `0xbd899115e3c6926d109a5bd39bf12646fae3862b` | `0x0d1fd4e57ec587bd880330d792600b577d97919454f1abaf8722e22f73d8dfa9` |
| First deposit (seed) | | `0xf4887d4563a65076ce2bec6356722e716563beb17f198e31c150c1da61750096` |

Pool id `0x3da5321a25b931eab270ee3b86490e10648ea54f25b2f4011679b4ddc74c498a`; USTX is currency0. The
script read back the hook's wiring and the pool price at the seeding block, and the record is in
`onchain/deployments/xlayer-testnet.json`. `V4_POOL_DEPLOYMENT` in `lib/xstocks/v4-liquidity.ts` pins
it, and `V4_HOOK_ADDRESS` in `relayer/wrangler.keeper.jsonc` has the keeper re-peg it.

## Measured against the constant-product pool

Pools shows both USTX/dUSD pools side by side over the same NAV records, from the v4 pool's
deployment on (`lib/xstocks/lp-markout.ts`, served as `lpResult` by `GET /api/v1/ustx/pools`). Each
trade counts for the providers what the pool took in less what it paid out, USTX at the NAV in effect
when the trade landed and demo dollars at face value: the fee, less what the trader gained by
trading away from the NAV. The app's activity cron reads the pools', the arbitrage contract's, the
pool manager's and the registry's events in block order and keeps the totals; a run that fails
changes nothing. `onchain/test/AppV4Client.test.ts` checks the reading of the pool manager's Swap
event against a swap on Uniswap's compiled PoolManager, and that the hook's own swap at a re-peg is
not counted.

Over the first 256 records (1 October 15:57 to 2 October 13:23 UTC), the keeper's three arbitrage
trades took $0.0505 from the constant-product pool's providers, the sum of what the keeper earned,
about −$20.52 a year per $10,000 of liquidity at the pool's value. The hook moved its pool to the NAV
254 times and no trade was open against a stale price; it had no other trades in that time either.
The NAV moved little between records, so the constant-product pool's loss stays small against its
0.3% fee; the tests above show the gap at a 5% move.

## What this does not cover

- **The NAV's latency.** A record prices the xStocks a few minutes earlier, and the prices are public
  before the record lands. Someone who knows the next NAV can trade at the current one until it does:
  in the tests, $1,500 bought before a record 2% higher and redeemed at the fund after it takes $20.69
  from a $10,000 pool. The fee, its rise with the NAV's age and the curve's slippage bound this, but a
  move larger than the fee between two records is still an opening; records more often, a fee sized
  to the move expected between records, or a surcharge on trades that move the price far from the NAV
  would narrow it. The testnet fund's own orders fill at the recorded NAV with no fee, a wider version
  of the same gap.
- **Standard ERC-20 tokens only.** The pool manager credits what actually arrives, so a token that
  delivers less than it is asked to send leaves it unsettled and the call reverts. xStocks can arrive a
  base unit short ([the in-kind vault record](IN_KIND_VAULT.md)); a pool of xStocks would hold
  `GanymedeBasketVault` shares, which are standard, rather than the xStocks themselves.
- **When it stops.** Swaps stop while the NAV is over an hour old, dated after the block or maps
  outside the tick range (deposits too while it is dated after the block), and a paused USTX stops swaps, deposits and withdrawals until it is
  unpaused. A deposit becomes shares only at a NAV record published after it, so while records stall
  it waits (it can be cancelled). The first swap after a record pays about 480,000 more gas for the
  re-peg unless someone calls `repeg()` first. `GanymedeNavRegistry` itself accepts any later
  `effectiveAt`; a record dated far ahead would stop these swaps and, since each record must be later
  than the last, block the records after it. A registry for mainnet should refuse times past its
  block.
- **Status.** Deployed on X Layer Testnet only, and not audited; Slither's findings and the invariant fuzzing are in [STATIC_ANALYSIS.md](STATIC_ANALYSIS.md). Two independent review rounds changed deposits to
  forward pricing, added the future-date check and closed the last way for a deposit to become
  liquidity just ahead of a trade it could see. A third made deposits wait while a record dated
  ahead of the block is out (taken then, a deposit would convert at that record once its time came)
  and sized a deposit that applies a record itself against the shares that record minted. The app shows the pool on Pools from its pinned
  deployment (see "In the app"); the USTX order panel quotes it beside the fund and the constant-product pool through `GanymedeV4Router.quoteExactInput` and routes a wallet order to whichever gives the most. The pool manager is Uniswap's BUSL-1.1 code, deployed
  here only on a testnet; the hook and router import v4-core's MIT-licensed interfaces and
  libraries. Demo dollars and USTX have no value.
