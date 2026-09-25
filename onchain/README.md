# Ganymede on-chain tooling

Deploys, verifies and inspects the settlement contracts in `../contracts` on
**X Layer testnet** (chain 1952, default) or GIWA Sepolia (`:giwa` scripts).

Requires Node.js `>=22.13.0`. Build output stays in this directory; the Solidity
sources stay in `contracts/`.

```bash
cd onchain
npm install
npm run build   # compile
npm test        # 29 tests, no network needed
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

## Verify the sources

Source verification makes the contract readable on the explorer. Pick either option.

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

Source-verified on the explorer, **unaudited**. X Layer testnet and GIWA Sepolia are settlement test
rail; it is not proof of custody, licensing or an Upbit mainnet relationship.
