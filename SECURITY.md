# Security

USTX is a demo fund on X Layer Testnet. It is bought with demo dollars (dUSD) that have no value, and no real asset, deposit or payment is held anywhere. The contracts are not audited. This file says who can do what, what we trust, how it is tested, and how to report a problem.

## Who can do what

Every role below can be read from the contracts on X Layer Testnet; the developer page (`/developers#proof-controls`) reads them in your browser and shows whether anything is paused. No administrator can issue USTX, change a recorded NAV or move anyone's USTX or demo dollars.

| Contract | Roles | What they can do | What nobody can do |
| --- | --- | --- | --- |
| `GanymedeNavRegistry` | administrator, publisher (the settlement relayer) | The publisher adds NAV records. The administrator can pause new records, name the publisher, and hand over administration in two steps. | Edit or delete a published record. |
| `GanymedeBasketFund` (USTX) | administrator | Pause investing and redeeming; hand over administration in two steps. | Issue USTX except by investing at the latest recorded NAV; redeem at another price; move a holder's USTX. |
| `GanymedeDemoDollar` (dUSD) | administrator, minter (the USTX fund) | Anyone claims 10,000 dUSD once a day. The minter issues dUSD for redemptions; the administrator names the minter. | Give dUSD a value or exchange it for money. |
| `GanymedeLendingMarket` | administrator | Pause new lending, borrowing and collateral; hand over administration in two steps. | Block repaying, withdrawing or liquidating (a pause never does); move a depositor's USTX or dUSD. |
| `GanymedeUstxPool` | none | — | Pause it, change its 0.30% fee or move its liquidity. |
| `GanymedeNavArbitrage` | none | Anyone closes the pool's gap to the NAV through the fund in one transaction. | Keep anything between trades. |
| `GanymedeNavFeed` | none | Serves the registry's USTX NAV in Chainlink's `AggregatorV3Interface`. | Configure it. |
| `GanymedeRwaLiquidityHook` | none | Moves its Uniswap v4 pool to each NAV record and holds liquidity for its depositors. | Call its hooks except through Uniswap's PoolManager; move depositors' liquidity. |
| `GanymedeV4Router` | none | Swaps on a v4 pool for whoever calls it, with the least they accept and a deadline. | Keep anything between transactions. |
| `GanymedeRangeLiquidityHook` | none | Opens each provider's bins near the NAV and closes them for their owner at any time, with their tokens and fees. | Call its hooks except through Uniswap's PoolManager; move another provider's position; let a swap leave the price more than about 5% from the NAV. |
| `GanymedeRangeArbitrage` | none | Anyone brings the range pool back to the NAV through the fund in one transaction, making up the fund's $10 minimum when the pool pays less. | Keep anything between trades; take demo dollars from anyone but its caller. |
| Uniswap v4 `PoolManager` | owner | Uniswap v4-core as published; the owner can set Uniswap's protocol fee, left at zero. | Move pool liquidity or change the hook. |

Administrator actions on the deployed contracts are taken only with the project owner's approval.

## What you trust

- **The prices.** The NAV is the nine xStocks' OKX OnchainOS market prices on X Layer, recorded every five minutes by the relayer's key. Anyone can recompute each record from its published holdings and compare the prices with the xStocks' X Layer pools; a price wrong in both sources would pass.
- **The publisher key.** A stolen publisher key could record a wrong NAV, at which the fund would issue and redeem and the lending market would value collateral, until the administrator paused the registry and named a new publisher. Records cannot be rewritten afterwards, so a wrong one stays visible.
- **Freshness.** The fund and the lending market refuse a NAV more than one hour old, so a stalled publisher stops wallet orders and new loans rather than filling them at an old price. Repaying and withdrawing never depend on it except where collateral must be valued.
- **The web app.** It builds every transaction in your browser, dry-runs it, and asks your wallet to sign; it never holds a key of yours. Public requests cannot gain operator access, and public GET requests never write to the server's database.

## How it is tested

- Contract tests in `onchain/test`, run with `npm test` in `onchain/`.
- Invariant fuzzing of the v4 hook (providers lose nothing at the NAV between records) and of the lending market (books balance, the market holds and is owed what it owes lenders, no loan is opened or left past its limit, only loans past the threshold are liquidated, a pause never blocks an exit, and everyone can leave at the end). Run longer with `HOOK_FUZZ_SEEDS`/`HOOK_FUZZ_STEPS` and `LENDING_FUZZ_SEEDS`/`LENDING_FUZZ_STEPS`.
- Slither over every contract (2 October, and the range pool's two contracts on 6 October), with each High and Medium finding triaged in [docs/STATIC_ANALYSIS.md](docs/STATIC_ANALYSIS.md).
- Testnet load tests ([docs/LOAD_TEST.md](docs/LOAD_TEST.md)): 51,854 transactions from 3,000 wallets through the fund and the lending market with none failing, and every wallet flow from 100 wallets (2,386 transactions; the 7 that reverted were the contracts refusing as they should).
- Every source matches exactly on Sourcify; the first eight contracts are also verified on the OKX explorer ([list](onchain/README.md#verify-the-sources)).

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** on this repository's Security tab, not in a public issue. Include the contract or page, the steps, and what an attacker gains. We aim to reply within three days. As everything is on testnet with demo dollars, there is no bounty.
