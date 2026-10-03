# Load test on X Layer Testnet, 2 October 2026

The team ran every wallet flow of the app with its own test wallets on X Layer Testnet, against the
production Worker, to find errors before the finale. **These wallets are the team's, not users.**
Their trades appear in the market activity, the pools' 24-hour figures and the pools' results for
their providers like any other trades; every wallet redeemed all its USTX at the end, so the fund's
investor count returned to where it was (5).

## What ran

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

## Results

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

## What it found

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

## Test wallets

The 30 wallets of the on-chain test: `0x113E68345861F71e5823f0636B755EBeCD0216E8`, `0x35D9819A955CB1dc25324dA0f546239DCF3b5173`, `0x1F630B67B8D0B681af41e0f51F4B364769cF1Eba`, `0xaB910EdD384bCedD5C45cd943c2F89650D2D4e5e`, `0xAd98e1D4C8728b931C802562C0a22a876eC8e425`, `0x99e2dc00be54aB6FA65F38FAc9C166AA211b97D2`, `0xA69227811884D7f915655428aAf23a07b39322A6`, `0x072f41C0ef90BC5FCC6D8e38F5E72E0AECc9866d`, `0xAd8ea07914F954d4da8314eb3b2481043c9a9b88`, `0xEe014a74eDF56bfBc1cb6715975232925108659C`, `0xb1610c5489ceAcCDA3dbDeCedAEC7f5D2ea3DBc9`, `0xB1b2FdB075Dec1FC3a78922DC7f58c3eD17c78C4`, `0x5803C1C05e0fc400B76F119bd9824B1d62BD6921`, `0xE7F60B3a35eF00d7C494D0569a454f65858DB088`, `0x922F9317C03b57a26f8e6435f0bE018E54723A61`, `0x96D1Fc2557630E189b5344524c987a483D80AeC0`, `0xF36ee64723F79B7f0E8B3C2841D5c6eF63f6Fa51`, `0x85C78B98B57B14F47B474920197805aC098D97E9`, `0xb7a76DDd1CEEF40969682E15a60BC6A8BAD49a79`, `0xf2d416288174FDDC6E0f6F4D870375CE3d74832b`, `0x48c7b1E7f2Fa8612de1464bFaad895bd6921a2a2`, `0xde667a33f070D116EBdE2978cEa25Aae292697bB`, `0x893239c88958cE8B6FC9551abf580b49f0A9B12A`, `0xDF42c07A014B6A7f70Ea390287A8E199c3385B38`, `0x33f2cc2629D9fcA39daa40d5B3c6718cA18670C5`, `0xAa709B6C50aAe223824133a5D42eD9F8F2e66f1C`, `0x0a5C9D0BdC5d3357BE88e39C8fcFf41741878785`, `0xca362664D0611BBC07583B4Be53F8AfbC030eeA3`, `0x6232daD717B0480421878f8A971FAEb3A85Fa803`, `0xf9dB4429F818F37f844d45DE9EF74d6411c17E07`.

The browser test used `0xb50794E6181e3311D6ae211E3Dd7723E9e66Af31`.
