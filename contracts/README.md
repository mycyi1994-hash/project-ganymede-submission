# Ganymede settlement contracts

These contracts separate the fund's off-chain asset custody and execution from its on-chain share and disclosure records.

- `GanymedeFundShare.sol` is a six-decimal, permissioned fund-share ledger. Only allowlisted investors can hold or transfer shares. Subscription and redemption settlement identifiers are one-time and idempotent.
- `GanymedeNavRegistry.sol` publishes monotonic NAV snapshots and rebalance evidence hashes.
- `GanymedeBasketFund.sol` is the USTX share token on X Layer Testnet. `invest(dollars, minShares)` takes demo dollars and issues shares at the latest NAV that `GanymedeNavRegistry` holds for `us-tech-x`; `redeem(shares, minDollars)` burns shares and pays demo dollars at that NAV. Orders need a record at most an hour old and at least $10, round down both ways, and revert past the caller's minimum. It holds no assets, no key can issue shares directly, and `investorCount()` counts holders on chain. The administrator can only pause.
- `GanymedeDemoDollar.sol` (dUSD) is a no-value demo dollar: anyone can `claim()` 10,000 once a day, and only the fund contract can mint more, to pay redemptions.
- `GanymedeNavFeed.sol` exposes one product's NAV from `GanymedeNavRegistry` through the `AggregatorV3Interface` that Chainlink price feeds use (`latestRoundData`, `getRoundData`, `decimals`, `description`, `version`, plus the older `latestAnswer`, `latestTimestamp` and `latestRound`), so apps that already read Chainlink prices can read USTX without custom code. Answers have 8 decimals (the registry's 6-decimal NAV × 100). The round ID, `startedAt` and `updatedAt` are the record's effective time, so a staleness check on `updatedAt` measures the age of the prices. Only the latest round is on chain; any other round ID reverts with `NoDataPresent`. It has no owner and nothing to configure.
- `GanymedeUstxPool.sol` is the secondary market: a constant-product pool of USTX and dUSD with Uniswap V2 arithmetic, a 0.3% fee to liquidity providers, slippage minimums and deadlines. Its price moves only with trades, so it drifts from the NAV as the NAV moves; `premiumBps()` reports the gap against the fund's `currentNav()`.
- `GanymedeNavArbitrage.sol` closes that gap in one transaction, the way ETF creation and redemption keep a fund near its NAV: below the NAV it buys USTX in the pool and redeems it at the fund (`buyAndRedeem`); above it, it invests at the fund and sells the new USTX in the pool (`investAndSell`). It reverts unless the caller gets back at least the input plus `minProfit`, and `quote()` returns the size that captures most of the gap. It has no owner and holds nothing between transactions.
- `GanymedeLendingMarket.sol` lends dUSD against USTX. Lenders `supply` dUSD and earn the interest borrowers pay, on a jump-rate curve (2% a year plus 10% × utilization up to 80%, then 200% × the excess); 10% of the interest stays in the market as reserves. Borrowers post USTX with `supplyCollateral` and `borrow` up to 50% of its value at the fund's `currentNav()`, so a stale NAV stops new loans. Once a loan's debt passes 65% of that value, anyone can `liquidate` up to half of it and receive USTX worth 8% more at NAV, which the fund redeems at NAV. The market starts paused, and pausing never blocks repaying, withdrawing or liquidating. It is written and tested but not deployed.

The fund, demo-dollar and lending contracts are for testnet demonstration with no value; they are not the production settlement path described below.

Production deployment requirements:

1. Independent administrator, issuer, transfer-agent and publisher multisigs.
2. KYC/AML before allowlisting an investor (on GIWA, also an Upbit Korea Dojang Verified Address check).
3. External custody and cash settlement confirmation before minting or burning shares.
4. Contract audit, deployment rehearsal, monitoring and emergency runbook.
5. A licensed fund, transfer agent, custodian and approved offering documents.

The backend never stores an EVM private key. It submits idempotent requests to a separately operated settlement relayer (`relayer/`) configured through hosted secrets. The contracts are plain EVM and deploy unchanged to X Layer (default) or GIWA Sepolia.
