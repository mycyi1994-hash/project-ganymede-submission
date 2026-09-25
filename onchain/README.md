# Ganymede on-chain tooling

Deploys, verifies and inspects the settlement contracts in `../contracts` on
**X Layer testnet** (chain 1952, default) or GIWA Sepolia (`:giwa` scripts).

Requires Node.js `>=22.13.0`. Build output stays in this directory; the Solidity
sources stay in `contracts/`.

```bash
cd onchain
npm install
npm run build   # compile
npm test        # 60 tests, no network needed
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

## Lending market (deployed, paused)

`GanymedeLendingMarket` lends dUSD against USTX collateral valued at the fund's
current NAV (rules in `../contracts/README.md`; 13 tests in
`test/GanymedeLendingMarket.test.ts`). It is deployed at
[`0xae2f54ae3d0370295de18510d56de92afb8843c7`](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7)
([creation](https://web3.okx.com/explorer/x-layer-testnet/tx/0xb771847aebe5f893eec25e97f99c69cc55f0f85fcaa71217facab2bd7df26278))
and paused: nothing can be supplied or borrowed until the administrator calls
`unpause()`, which needs the user's approval. It is not in the app.

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
funds. The script never unpauses the market; activating it is a separate
decision.

## Verify the sources

Source verification makes the contract readable on the explorer. All eight
deployed contracts match exactly (creation and runtime bytecode) on Sourcify,
and all but the newly deployed lending market are verified on the OKX explorer:

| Contract | OKX explorer | Sourcify |
| --- | --- | --- |
| `GanymedeNavRegistry` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c) | [exact match](https://repo.sourcify.dev/1952/0xf320d2a7f280b7ab61e24374986869d7be34289c) |
| `GanymedeFundShare` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59) | [exact match](https://repo.sourcify.dev/1952/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59) |
| `GanymedeDemoDollar` (dUSD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf) | [exact match](https://repo.sourcify.dev/1952/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf) |
| `GanymedeBasketFund` (USTX) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596) | [exact match](https://repo.sourcify.dev/1952/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596) |
| `GanymedeUstxPool` (USTX/dUSD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1) | [exact match](https://repo.sourcify.dev/1952/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1) |
| `GanymedeNavArbitrage` | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9) | [exact match](https://repo.sourcify.dev/1952/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9) |
| `GanymedeNavFeed` (USTX / USD) | [verified](https://web3.okx.com/explorer/x-layer-testnet/address/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8) | [exact match](https://repo.sourcify.dev/1952/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8) |
| `GanymedeLendingMarket` (paused) | [upload pending](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7) | [exact match](https://repo.sourcify.dev/1952/0xae2f54ae3d0370295de18510d56de92afb8843c7) |

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
