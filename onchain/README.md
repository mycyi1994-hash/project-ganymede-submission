# Ganymede on-chain tooling

Deploys, verifies and inspects the settlement contracts in `../contracts` on
**X Layer testnet** (chain 1952, default) or GIWA Sepolia (`:giwa` scripts).

Requires Node.js `>=22.13.0`. Build output stays in this directory; the Solidity
sources stay in `contracts/`.

```bash
cd onchain
npm install
npm run build   # compile
npm test        # 98 tests, no network needed
```

## Keys

Two independent keys. This separation is the security model — do not collapse them.

| Key | Holds | Exposure |
| --- | --- | --- |
| `ADMIN_PRIVATE_KEY` | administrator on both contracts, transfer agent on the share ledger | cold, used only for deploy / allowlist / pause |
| `RELAYER_PRIVATE_KEY` | issuer on the share ledger, publisher on the NAV registry | hot, lives in the relayer Worker |

A leaked relayer key can mint, burn and publish. It cannot pause, reassign roles
or allowlist an investor. In production both roles move to independent multisigs
(`contracts/README.md`).

Generate them locally and keep them out of the repository:

```bash
cp .env.example .env
# then fill in ADMIN_PRIVATE_KEY and RELAYER_PRIVATE_KEY
```

Fund `ADMIN` and `RELAYER` with testnet OKB from the X Layer faucet
(https://web3.okx.com/xlayer/faucet) before deploying — both send transactions.
For GIWA Sepolia, fund them with GIWA Sepolia ETH instead.

Optional `.env` values: `XLAYER_RPC_URL` (overrides the public
`https://testrpc.xlayer.tech/terigon`), `OKLINK_API_KEY` (source verification on
X Layer), `GIWA_RPC_URL` and `EXPLORER_API_KEY` (GIWA only).

## Deploy

```bash
npm run deploy
```

Deploys `GanymedeFundShare` and `GanymedeNavRegistry`, hands issuance to the
relayer key, asserts every role landed as intended, and writes
`deployments/xlayer-testnet.json` (or `deployments/giwa-sepolia.json` with
`npm run deploy:giwa`). It prints the two `hardhat verify` commands and
the `.env` lines for the application.

One NAV registry serves all four products — the product id is a `bytes32` key.
The share ledger carries one fund's name and symbol, so it is deployed for
`GMD CORE` first; the other three follow the same pattern when needed.

## Deploy wallet investing (USTX on X Layer Testnet)

```bash
npm run deploy:fund
```

Deploys `GanymedeDemoDollar` and `GanymedeBasketFund` next to the recorded NAV
registry, makes the fund the demo dollar's minter, reads the wiring back and adds
both to `deployments/xlayer-testnet.json`. The app pins the two addresses in
`lib/xstocks/fund.ts`; `test/AppFundClient.test.ts` checks the pin and the
app's hard-coded selectors against the compiled contracts.

## USTX NAV feed

Deployed at [`0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8`](https://web3.okx.com/explorer/x-layer-testnet/address/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8) for `us-tech-x` ("USTX / USD").

```bash
npm run deploy:feed
```

Deploys `GanymedeNavFeed` for `us-tech-x` ("USTX / USD", 8 decimals) next to the
recorded NAV registry, reads the wiring and the first answer back at the
deployment block, and records the address and creation transaction in
`deployments/xlayer-testnet.json`. Any app that reads a Chainlink price feed can
point at it:

```solidity
(, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();
require(block.timestamp - updatedAt <= 1 hours, "stale NAV"); // records land every five minutes
uint256 ustxInUsd8 = uint256(answer);                        // 8 decimals
```

## USTX pool and NAV arbitrage

Deployed: the pool at [`0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1`](https://web3.okx.com/explorer/x-layer-testnet/address/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1), seeded at the NAV with
50.1174 USTX and $5,000 of demo dollars, and the arbitrage contract at
[`0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9`](https://web3.okx.com/explorer/x-layer-testnet/address/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9). In [an arbitrage on X Layer
Testnet](https://web3.okx.com/explorer/x-layer-testnet/tx/0x3c604c934a1ef7576a173e0b513c419ad89376f1c6bea17464f8c5afbb9f6c2e) a seller had pushed the pool 17.3% below the NAV;
`buyAndRedeem` put in $447.82, got back $491.80 and left the pool 0.27% below
the NAV, inside the 0.3% fee. The arbitrage keeper (`relayer/src/keeper.ts`)
sends the same trade on its own: after a sale left the pool 6.02% below the NAV,
[its next run](https://web3.okx.com/explorer/x-layer-testnet/tx/0xbec5c89a1546e65c1f03a4131c85c1ef50e1ac9e3f4e6e09f929b33f7c33d26f)
put in $145.92, got back $150.30 and left the pool 0.29% below the NAV.

```bash
npm run deploy:pool
```

Deploys `GanymedeUstxPool` and `GanymedeNavArbitrage` next to the recorded
fund, then seeds the pool from the administrator wallet: claim 10,000 demo
dollars, invest $5,000 at the fund and add the USTX received with the same
value in demo dollars, so the pool opens at the NAV. Each transaction carries
its own nonce and gas limit, because a node behind the load-balanced RPC can lag
the last receipt. The script records both addresses, their creation
transactions and the seeding transaction.

## Lending market (live)

`GanymedeLendingMarket` lends dUSD against USTX collateral valued at the fund's
current NAV (rules in `../contracts/README.md`; 13 tests in
`test/GanymedeLendingMarket.test.ts`). It is deployed at
[`0xae2f54ae3d0370295de18510d56de92afb8843c7`](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7)
([creation](https://web3.okx.com/explorer/x-layer-testnet/tx/0xb771847aebe5f893eec25e97f99c69cc55f0f85fcaa71217facab2bd7df26278))
and live: the administrator unpaused it with the user's approval
([unpause](https://web3.okx.com/explorer/x-layer-testnet/tx/0x1acb998775cb55926d585611f9cc18171ab63015b86b62927828d237af6a873f)), a test wallet
supplied the first $5,000 of demo dollars
([supply](https://web3.okx.com/explorer/x-layer-testnet/tx/0xaae154df99a842a354c832fbaefff5fdadaf5ae0538fdb3408b0dce1a5ea67af)), and the USTX page's
Borrow section deposits USTX, borrows, repays, withdraws and lends through it.
Pausing it again needs the user's approval.

Try a full cycle against the live contracts without touching the deployment:

```bash
npm run fork:lending
```

This forks X Layer Testnet into memory, deploys the market next to the recorded
dUSD, USTX fund and NAV registry, and runs one cycle with local test accounts:
supply, USTX bought at the live NAV and posted, a loan, a 30% lower NAV recorded
by the impersonated publisher, liquidation, redemption of the seized USTX at the
fund (the 8% bonus), repayment and withdrawal. It uses no key and broadcasts
nothing.

The deployment used

```bash
npm run deploy:lending
```

which deploys the market next to the recorded fund with its own nonce and gas
limit, reads the wiring back, confirms it is paused and adds it to
`deployments/xlayer-testnet.json` with its creation transaction. It was
rehearsed first on a local fork of X Layer Testnet with a key holding no real
funds. The deploy script never unpauses the market; activating it was a separate
decision, taken with

```bash
npm run activate:lending
```

which runs `unpause()` as a simulation first, sends it from the administrator
key, reads `paused = false` back at the receipt's block and records the
transaction.

## In-kind vault (fork of X Layer mainnet)

`GanymedeBasketVault` creates and redeems a basket token in kind: shares are created only by
delivering the constituents, the first creation at a fixed quantity per share and later ones in
proportion to the holdings, and redeemed for a proportional share of them (rules in
`../contracts/README.md`; 7 tests in `test/GanymedeBasketVault.test.ts`, including a multiplier
token like the xStocks). It is not deployed. Run it against the real xStocks:

```bash
npm run fork:vault
```

This forks X Layer mainnet into memory and, with local test accounts, buys AAPLx, MSFTx and NVDAx
on their Uniswap V3 pools with USDG (taken on the fork from a pool outside the basket) and unwraps
each pool's ERC-4626 wrapper into the xStock; deploys the vault with MAG3's units per share
(`../public/baskets/mag3/basket.json`) for the first creation; creates 10 shares; moves 4 shares to
a second account, which redeems them for 4/10 of the holdings; and redeems the rest, checking every
amount. It uses no key and broadcasts nothing. The run on 25 September 2026 is recorded in
`../docs/IN_KIND_VAULT.md`.

## Positions of one's own: Spot, Curve and Bid-Ask (fork of X Layer Testnet)

`GanymedeRangeLiquidityHook` opens a second USTX/dUSD pool on the same PoolManager in which every
liquidity provider holds a position of their own: a run of equal-width bins either side of the price,
demo dollars below it and USTX above, spread evenly (Spot), heaviest next to the price (Curve) or
heaviest at the far ends (Bid-Ask), with up to 20 bins of 0.1% to 5% on each side. Positions open only
with the price within 1% of a fresh NAV; swaps need a NAV under an hour old, pay 0.30% rising to 1.00%
as it ages, and may not leave the price more than 5% from it. Each position's liquidity sits under its
own salt, so its fees are its owner's alone, and closing pays tokens and fees at any NAV.
`GanymedeRangeArbitrage` brings the pool back to the NAV through the fund in one transaction with no
money of the caller's: it swaps in the pool up to the NAV less the fee and redeems (or invests and
sells), keeping the difference. 5 tests in `test/GanymedeRangeLiquidityHook.test.ts`. Rehearse it:

```bash
npm run fork:range
```

forks X Layer Testnet, impersonates the administrator, deploys both contracts on the recorded
PoolManager, opens one position of each shape, buys $200 of USTX through the router, records a NAV 1%
higher and runs the arbitrage, then closes the Bid-Ask position with its fees. `npm run deploy:range`
did the same deployment and seeding on X Layer Testnet on 4 October 2026, with the user's approval, and
recorded both contracts in `deployments/xlayer-testnet.json`; the app pins the pool in
`../lib/xstocks/range-liquidity.ts` (checked by `test/AppRangeClient.test.ts`) and the keeper runs the
arbitrage through `RANGE_ARBITRAGE_ADDRESS`. On 6 October, with the user's approval,
`RANGE_REPLACE=<recorded hook> npm run deploy:range` replaced it with a hook whose `open()` takes a
price limit (hook `0x79b7985e025dbab36cffbfd82863b4f2f50128c0`, arbitrage
`0xf76fa2ff202613556e6f30e3dda130a2fa10c593`): it deployed and seeded the new pair, closed the
administrator's seed positions in the old hook, and kept the old hook under `replaced` in the record. It
refuses to replace a hook in which another wallet holds an open position, since the app reads only the
recorded one; `npm run fork:range` with the same variable rehearses it.

Known limits, from the 4 October audit: `open()` took no expected price, so a position opened around
wherever the price was within 1% of the NAV (the app refuses to send one when the pool is more than
0.95% away). Since the 6 October hook it takes `minTick` and `maxTick` and reverts with
`PriceOutsideLimit` unless the pool's tick is within them; Pools sends the tick the provider saw, give
or take 30 (about 0.3%). Bins can reach past the 5% band, where they never trade; a paused fund stops payouts of
USTX, closing included. The first arbitrage contract reverted where no position lay between the
price and the NAV; it was replaced (`npm run deploy:range-arbitrage`) by one that moves the price across
such a stretch for nothing, which the keeper sends when the call returns a profit of 0. It also sends
a profit under a cent, insisting on half of it, while the price is more than 0.95% from the NAV, so a
little USTX between a price under the NAV and the NAV no longer leaves positions shut out. Over the
NAV, selling into less than $10 of demo dollars could not pay the fund's $10 minimum investment, so
that arbitrage reverted (`Unprofitable(0)`). The third arbitrage, deployed on 6 October with the
user's approval (`0x58571aa0519a82f1d3839cae5392dfb060c5d572`), draws what the pool pays short of the
fund's need from the caller's approved demo dollars instead: the rest of the $10 minimum when
selling, repaid in USTX worth more at the NAV, or a rounding remainder of up to a cent when buying.
The keeper approves its demo dollars to it once. The arbitrage deployed with the 6 October hook
(`0xf76fa2ff202613556e6f30e3dda130a2fa10c593`) is the same contract for the new pool.

## Uniswap v4 liquidity for USTX (fork of X Layer Testnet)

`GanymedeRwaLiquidityHook` is a Uniswap v4 hook that runs a USTX/dUSD pool around the NAV and holds
its liquidity for the providers who deposit into it; `GanymedeV4Router` swaps on it (rules in
`../contracts/README.md`, design and a recorded run in `../docs/UNISWAP_V4_LIQUIDITY.md`; 23 tests in
`test/GanymedeRwaLiquidityHook.test.ts`). The Solidity imports come from `@uniswap/v4-core` 1.0.2 in
this package; `hardhat.config.ts` lets the repository-root build find them here. Uniswap has deployed
v4 on X Layer mainnet but not on X Layer Testnet, so the tests and scripts deploy the PoolManager from
that package as Uniswap built it. It is deployed on X Layer Testnet (addresses in
`deployments/xlayer-testnet.json`). Run it against the live contracts on a fork:

```bash
npm run fork:v4
```

This first checks that Uniswap's PoolManager on X Layer mainnet runs the same code, then forks X Layer
Testnet into memory and deploys the PoolManager, the hook (priced by the recorded `GanymedeNavFeed`,
at a CREATE2 address mined for its permissions through the deterministic deployment proxy) and the
router. With local test accounts a provider deposits USTX bought at the live NAV with the same value
in dUSD, a trader buys and sells, a second provider's deposit waits for the next record, and the
impersonated publisher records a NAV 1% higher, which opens an arbitrage on the live constant-product
pool, while the next swap re-pegs the hooked pool and turns the waiting deposit into shares at the
new NAV. Both providers withdraw. It prints the gas of each step, uses no key and broadcasts nothing.

Deploying it on X Layer Testnet needs the user's approval:

```bash
npm run deploy:v4
```

deploys the PoolManager (owned by the administrator), the hook and the router with the same routine,
each transaction with its own nonce and gas limit, seeds the pool from the administrator wallet
(claim 10,000 dUSD, invest $5,000, deposit the USTX with $5,000), reads the wiring back and records
the addresses, the salt and the pool ID in `deployments/xlayer-testnet.json`.

```bash
npm run trade:v4
```

makes demo trades on the deployed pool from the administrator wallet: a purchase of USTX with $25 of
demo dollars (`TRADE_DOLLARS` to change it) and a sale of half of it through the router, each at
least 99% of the router's quote, and a deposit of the rest that becomes LP tokens at the next NAV
record; a later run claims them. Trades, not administrator actions; demo dollars have no value.

## Verify the sources

Source verification makes the contract readable on the explorer. All eight
deployed contracts are verified on the OKX explorer and match exactly (creation
and runtime bytecode) on Sourcify:

| Contract | OKX explorer | Sourcify |
| --- | --- | --- |
| `GanymedeNavRegistry` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c) | [exact match](https://repo.sourcify.dev/1952/0xf320d2a7f280b7ab61e24374986869d7be34289c) |
| `GanymedeFundShare` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59) | [exact match](https://repo.sourcify.dev/1952/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59) |
| `GanymedeDemoDollar` (dUSD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf) | [exact match](https://repo.sourcify.dev/1952/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf) |
| `GanymedeBasketFund` (USTX) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596) | [exact match](https://repo.sourcify.dev/1952/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596) |
| `GanymedeUstxPool` (USTX/dUSD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1) | [exact match](https://repo.sourcify.dev/1952/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1) |
| `GanymedeNavArbitrage` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9) | [exact match](https://repo.sourcify.dev/1952/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9) |
| `GanymedeNavFeed` (USTX / USD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8) | [exact match](https://repo.sourcify.dev/1952/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8) |
| `GanymedeLendingMarket` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7) | [exact match](https://repo.sourcify.dev/1952/0xae2f54ae3d0370295de18510d56de92afb8843c7) |

MAG3's registry, a second `GanymedeNavRegistry` deployed by the demo issuer wallet at
[`0xf412ba3857f63f513b93c4a8e3cacc1f162daa60`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf412ba3857f63f513b93c4a8e3cacc1f162daa60),
also matches exactly on [Sourcify](https://repo.sourcify.dev/1952/0xf412ba3857f63f513b93c4a8e3cacc1f162daa60).

To verify a new deployment, pick one of the options below.

**Option A: manual upload (no API key).**

```bash
npm run verify:export
```

This writes `deployments/verification/xlayer-testnet/` with, per contract, the
exact solc **Standard JSON input** and a `.txt` holding the address, compiler
version, optimizer settings and ABI-encoded constructor arguments. Open the
contract on the OKX explorer
(`https://www.okx.com/web3/explorer/xlayer-test/address/<address>`), go to the
**Contract** tab → verify and publish, choose "Standard JSON input", upload the
file and paste the constructor arguments. The exported input recompiles to
byte-identical runtime code (checked against a local deployment).

The compiler field needs the full version string, for example
`v0.8.28+commit.7893614a`.

**Option B: the plugin with an OKLink API key.** Set `OKLINK_API_KEY`, then run
the two commands the deploy step printed:

```bash
npx hardhat verify --network xlayerTestnet <fundShare> "Ganymede Core 20" "GMDCORE" <admin>
npx hardhat verify --network xlayerTestnet <navRegistry> <admin> <relayer>
```

**Option C: Sourcify (no API key).** Sourcify supports X Layer Testnet. POST the
same Standard JSON input to `https://sourcify.dev/server/v2/verify/1952/<address>`
with `compilerVersion` (`0.8.28+commit.7893614a`), `contractIdentifier`
(`contracts/<Contract>.sol:<Contract>`) and `creationTransactionHash`, then poll
`/v2/verify/<verificationId>`. Sourcify recompiles the input and compares both
the creation and the runtime bytecode. The OKX explorer does not read Sourcify,
so it still needs option A or B.

## Allowlist an investor

Minting to a wallet that is not allowlisted reverts with `TransferRestricted`.
Allowlisting runs under `ADMIN`, never the relayer:

```bash
WALLETS=0xabc...,0xdef... npm run allowlist
```

## Inspect

```bash
npm run status
```

Reads roles, total supply, pause state and the latest published NAV per product
straight off chain, and prints the explorer links.

## Generating on-chain activity

A deployed contract with no transactions does not demonstrate a working system.
Activity comes from the engine itself once the relayer is wired up — see
`../relayer/README.md`. Each engine cycle publishes a NAV per product plus
rebalance evidence, so the explorer fills with real settlement traffic rather
than hand-made demo transactions.

## Status

Source-verified on the OKX explorer and on Sourcify, **unaudited**. X Layer testnet and GIWA Sepolia are settlement test
rail; it is not proof of custody, licensing or an Upbit mainnet relationship.
