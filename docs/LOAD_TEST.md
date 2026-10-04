# Load tests on X Layer Testnet

The team runs the app's wallet flows with its own test wallets on X Layer Testnet, against the
production Worker, to find errors before users do. **These wallets are the team's, not users.**
`lib/xstocks/load-test-wallets.ts` lists all 3,000 test wallets and `lib/xstocks/team-wallets.ts` the rest, and the usage figures leave them out. Every run
ends with each wallet holding no USTX, loan, collateral or liquidity, so the fund's investor count
returns to where it was (5). No transaction is sent in the 45 seconds after each five-minute mark,
while the NAV record is written, and the administrator sends each wallet a little testnet OKB for gas
and takes back what is left. The keys are in `onchain/.stress/keys.json`, git-ignored and never
printed.

| Date | Test | Transactions | Result |
| --- | --- | --- | --- |
| 4 October | Lending market and fund, 3,000 wallets (`npm run stress:lending`) | 51,854, after about 1,700 in a first part that was stopped | All succeeded |
| 4 October | Lending market, 100 wallets (`npm run stress:lending`) | 6,200 (6,000 in the lending market) | All succeeded |
| 4 October | Every wallet flow, 100 wallets (`npm run stress:testnet`), with 2,147 HTTP requests | 2,386 | 2,379 succeeded; 7 reverted as the contracts should (below) |
| 2 October | Every wallet flow, 30 wallets, with 1,198 HTTP requests | 618 | All succeeded |

## 4 October: 3,000 wallets, 51,854 transactions

`npm run stress:lending` with `STRESS_WALLETS=3000`, 32 at a time, `STRESS_CYCLES=1`,
`STRESS_EXTRA_ROUND_EVERY=5` and 0.00006 testnet OKB of gas each, 10:44–12:03 UTC. Each new wallet
claimed demo dollars, approved the fund and the lending market, invested $250–400 at the fund, ran
one round of the lending market's ten transactions (every fifth wallet two rounds) and redeemed all
its USTX. It tried the five wrong orders of the 100-wallet run without sending them.

| Measure | Result |
| --- | --- |
| Wallets | 2,886 in this run (wallets 114 to 2,999), each sending its own transactions; the first 114 ran in the first part |
| Transactions | 51,854 sent, 51,854 succeeded, 0 failed or reverted: 2,863 each of claim and the three approvals, 2,886 investments and redemptions, 3,463 of each lending step |
| Wrong orders | 14,430 tried, all refused with the expected error (`InsufficientCollateral` 8,658, `BelowMinimum` 2,886, `InsufficientBalance` 2,886) |
| Rate | About 11 transactions a second over 78 minutes, the NAV windows included |
| Time to confirmation | 1.0 s median, 1.6 s at the 95th percentile, 21 s at most |
| Gas | 3.44 billion, about 0.069 testnet OKB; 0.173 sent out for gas and 0.101 sent back |
| Market before → after | Cash $4,790.00 → $4,790.02; reserves up $0.012 from the test loans' interest |
| End state | Every wallet holds no USTX, loan, collateral or lending; investors 5 → 5 |
| NAV record | All six products recorded at every five-minute mark from 10:35 to 12:01 |

What it found:
1. **Usage is classified when it is counted.** The first part started at 10:09 before wallets 101
   to 3,000 were listed as the team's, and the Worker then running counted 35 of them as outside
   wallets (423 actions). The run was stopped at 10:17 and the wallets it left part-way were
   cleaned up. All 3,000 were then listed (PR #89), and a one-time correction moved exactly those
   wallets, actions and trades to the team's figures (PR #90, with the counts by kind read from X
   Layer). Usage then read 2 outside wallets and 71 actions again, as before the test. A load test
   lists its wallets before the first transaction.
2. **The 24-hour figures under this load.** The activity index keeps the latest 1,500 rows. At
   11 transactions a second that is a few minutes, so Markets and Pools showed 24-hour figures
   "counted since" a recent time (`complete: false`). The screens say so, but their caption says
   earlier activity "is still being read", while under this load those rows were dropped. Keeping
   24-hour totals apart from the rows would fix this.
3. **One slow confirmation.** One transaction took 21 seconds to confirm; the 95th percentile
   stayed at 1.6 seconds.

## 4 October: lending market, 100 wallets

`npm run stress:lending` with 100 wallets, 10 at a time and 6 rounds each, 06:29–06:57 UTC. Each
wallet invested $250–400 at the fund for collateral and then, in each round:
1. posted 40–60% of its USTX as collateral;
2. borrowed 25–40% of its borrow limit (at least $10), then $10 more;
3. took back a fifth of the collateral while the loan was open;
4. repaid half the loan, then all of it, and took back the rest of the collateral;
5. lent $20–80 of demo dollars, withdrew half and then the rest.

At the end it redeemed all its USTX at the fund. In its first round it also tried five wrong orders
without sending them: a loan with no collateral, a loan under the $10 minimum, a loan past the borrow
limit, taking back all collateral while borrowing, and withdrawing more than it lent.

| Measure | Result |
| --- | --- |
| Transactions | 6,200 sent, 6,200 succeeded, 0 failed or reverted: 600 each of post collateral, borrow, borrow more, partial collateral withdrawal, repay half, repay in full, collateral withdrawal, lend, withdraw half and withdraw the rest; 100 investments and 100 redemptions |
| Wrong orders | 500 tried, 500 refused with the expected error (`InsufficientCollateral` 300, `BelowMinimum` 100, `InsufficientBalance` 100) |
| Time to confirmation | 1.2 s median, 1.9 s at the 95th percentile, 3.6 s at most |
| Gas | 433 million, about 0.0087 testnet OKB |
| Market before → after | Cash $4,790.00 → $4,790.00, lent $5,000.11 → $5,000.11, borrowed $210.12 → $210.12 (other wallets' loans), reserves up $0.002 from the test loans' interest |
| End state | Every wallet holds no USTX, loan, collateral or lending; investors 5 → 5 |
| NAV record | All six products (USTX and the five funds) recorded every five minutes through the run |

## 4 October: every wallet flow, 100 wallets

`npm run stress:testnet` with `STRESS_WALLETS=100` and 6 at a time, 05:41–06:10 UTC. The same flow as
on 2 October (below), plus a deposit into the Uniswap v4 pool: three wallets in four cancel it at
once, and every fourth keeps it until a NAV record turns it into LP tokens, then withdraws them.

| Measure | Result |
| --- | --- |
| Transactions | 2,386 sent: 2,379 succeeded, 7 reverted |
| Wrong orders | 296 tried without sending, all refused with the expected error (`BelowMinimum` 100, `SlippageExceeded` 100, `InsufficientCollateral` 96) |
| Time to confirmation | 1.5 s median, 2.1 s at the 95th percentile, 3.2 s at most |
| Gas | 194 million, about 0.0039 testnet OKB |
| NAV record | Every five-minute record in the window succeeded |

The 7 reverts, replayed at the block before each, are the contracts refusing as they should:
- 3 `SlippageExceeded` in the constant-product pool: wallets traded the same small pool within
  seconds, so a price moved past the 3% limit set from an earlier quote.
- 3 `InsufficientCollateral`: the script borrowed a fixed $17–19, over the limit of a wallet that had
  posted little USTX. The lending test below borrows a share of each wallet's own limit instead.
- 1 `NothingToCancel`: a NAV record had already turned the wallet's v4 deposit into LP tokens.

A wallet stopped at its revert, so 7 kept some USTX, collateral or liquidity; a clean-up pass took it
all back and the investor count returned from 12 to 5.

The HTTP side ran at the same time: 100 browser sessions each bought and half-redeemed the five other
funds with a demo balance (500 buys, 500 redeems), every fifth also bought and redeemed USTX (20
each), each sent one order under the minimum, which was refused with 400 `invalid_order` (100), and
each reset its demo balance. Two readers called the public APIs, pages and MCP tools in turn. Of
2,147 requests, none failed other than the 100 meant to: fund orders took 0.7 s at the median and
1.2 s at the 95th percentile, public APIs and pages 26–95 ms, MCP tools 0.5 s.

## 2 October: every wallet flow, 30 wallets
The team ran every wallet flow of the app with its own test wallets on X Layer Testnet, against the
production Worker, to find errors before the finale. **These wallets are the team's, not users.**
Their trades appear in the market activity, the pools' 24-hour figures and the pools' results for
their providers like any other trades; every wallet redeemed all its USTX at the end, so the fund's
investor count returned to where it was (5).

### What ran

| Test | Tool | Load |
| --- | --- | --- |
| Every wallet flow on chain | `npm run stress:testnet` in `onchain/` (`scripts/stress-testnet.ts`) | 30 wallets, 4 at a time, 17:22–17:34 UTC |
| The app in a browser with a wallet | `onchain/scripts/e2e-wallet.mjs` (Playwright, the wallet injected as `window.okxwallet`) | One wallet through the USTX order panel, Borrow and Pools |
| Pages, public APIs and the MCP server | A script calling 18 routes in turn | 2 requests a second for 10 minutes, during the on-chain test |

Each test wallet claimed demo dollars, approved the contracts and then:
- invested at the fund;
- bought and sold on the constant-product pool and through the Uniswap v4 router;
- added and removed liquidity in the constant-product pool;
- posted USTX as collateral, borrowed, repaid in full and withdrew it; every third wallet also lent
  demo dollars and withdrew them;
- redeemed all its USTX at the fund.

It also tried three wrong orders without sending them (an investment under $10, a pool trade
above its quote, a loan past the borrow limit), which must revert with the contracts' own errors.
No transaction was sent in the 45 seconds after each five-minute mark, while the NAV record is
written. The administrator sent each wallet 0.0004 testnet OKB for gas and took back what was left.

### Results

| Measure | Result |
| --- | --- |
| Transactions | 618 sent, 618 succeeded, 0 failed or reverted |
| Wrong orders | 90 tried, 90 refused with the expected error (`BelowMinimum`, `SlippageExceeded`, `InsufficientCollateral`) |
| Time to confirmation | 1.7 s median, 2.4 s at the 95th percentile, 3.0 s at most |
| Gas | 46.5 million, about 0.00093 testnet OKB |
| Browser flows | Connect, claim, buy at the fund, the pool and the v4 pool, sell at the fund, Portfolio; deposit collateral, borrow, repay, withdraw, lend, withdraw; add liquidity from demo dollars and withdraw it: all passed |
| HTTP requests | 1,198 by the script, 0 errors. Pages: 60–80 ms median. `/api/v1/ustx` 1.0 s, `/api/v1/ustx/pools` 2.6 s, MCP tools 1.0–2.7 s median (each reads X Layer when called) |
| Worker | 1,315 requests in the window, none failed or answered 5xx; no error logs |
| NAV record | Every five-minute record and activity run in the window succeeded |

### What it found

1. **A preload of a missing script (fixed).** Every product page preloaded
   `/assets/product-….js`, which the build never wrote: the product stylesheet was imported on its
   own by two modules, so the build made a chunk holding only the stylesheet, dropped it as empty
   and kept its preload. Browsers logged a 404. The stylesheet now rides on a module both already
   share (`app/product-ui/Icons.tsx`); every asset a page names now loads.
2. **Reads ahead of a lagging RPC node (no change).** Right after a transaction, the app pins its
   reads to the receipt's block. A node of the public RPC that has not reached that block answers
   HTTP 400 "block is out of range", the app reads again, and the screen updates. Browsers log the
   400; users see nothing.
3. **The pool's price under a burst of buying, and the keeper.** With 30 wallets buying in the
   constant-product pool within minutes, its price reached 4.01% above the NAV. The arbitrage keeper
   closed the gap at its next five-minute check, with nobody involved: it invested at the fund,
   sold 1.7315 USTX in the pool and earned $6.12, leaving the pool 0.29% above the NAV.
4. **Slower reads (fixed on 3 October).** The pools API and the MCP pools tool took 2.6–2.7 s at the
   median because each request read both pools from X Layer. A cron now reads both pools every
   minute and stores them in the engine state; the API serves that read while it is under 90
   seconds old, and each server instance keeps what it served for 30 seconds. X Layer is read for a
   request only when the snapshot is older, and when X Layer cannot be read, a read up to 10 minutes
   old is served marked `stale`. The response's `readAt` says when X Layer was read.

### Test wallets

The 30 wallets of the on-chain test: `0x113E68345861F71e5823f0636B755EBeCD0216E8`, `0x35D9819A955CB1dc25324dA0f546239DCF3b5173`, `0x1F630B67B8D0B681af41e0f51F4B364769cF1Eba`, `0xaB910EdD384bCedD5C45cd943c2F89650D2D4e5e`, `0xAd98e1D4C8728b931C802562C0a22a876eC8e425`, `0x99e2dc00be54aB6FA65F38FAc9C166AA211b97D2`, `0xA69227811884D7f915655428aAf23a07b39322A6`, `0x072f41C0ef90BC5FCC6D8e38F5E72E0AECc9866d`, `0xAd8ea07914F954d4da8314eb3b2481043c9a9b88`, `0xEe014a74eDF56bfBc1cb6715975232925108659C`, `0xb1610c5489ceAcCDA3dbDeCedAEC7f5D2ea3DBc9`, `0xB1b2FdB075Dec1FC3a78922DC7f58c3eD17c78C4`, `0x5803C1C05e0fc400B76F119bd9824B1d62BD6921`, `0xE7F60B3a35eF00d7C494D0569a454f65858DB088`, `0x922F9317C03b57a26f8e6435f0bE018E54723A61`, `0x96D1Fc2557630E189b5344524c987a483D80AeC0`, `0xF36ee64723F79B7f0E8B3C2841D5c6eF63f6Fa51`, `0x85C78B98B57B14F47B474920197805aC098D97E9`, `0xb7a76DDd1CEEF40969682E15a60BC6A8BAD49a79`, `0xf2d416288174FDDC6E0f6F4D870375CE3d74832b`, `0x48c7b1E7f2Fa8612de1464bFaad895bd6921a2a2`, `0xde667a33f070D116EBdE2978cEa25Aae292697bB`, `0x893239c88958cE8B6FC9551abf580b49f0A9B12A`, `0xDF42c07A014B6A7f70Ea390287A8E199c3385B38`, `0x33f2cc2629D9fcA39daa40d5B3c6718cA18670C5`, `0xAa709B6C50aAe223824133a5D42eD9F8F2e66f1C`, `0x0a5C9D0BdC5d3357BE88e39C8fcFf41741878785`, `0xca362664D0611BBC07583B4Be53F8AfbC030eeA3`, `0x6232daD717B0480421878f8A971FAEb3A85Fa803`, `0xf9dB4429F818F37f844d45DE9EF74d6411c17E07`.

The browser test used `0xb50794E6181e3311D6ae211E3Dd7723E9e66Af31`.
