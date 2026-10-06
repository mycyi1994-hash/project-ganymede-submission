# Build provenance

Production source revision: `9d8c2f8859f53a2f3efc1614681a782aef38bab7`.

This is a source snapshot, not a claim that the entire project was newly built for this event. The original repository remains private. The entries below were exported from its Git history; reviewers can inspect current implementations and tests, and request original history access from the team if needed. No old secrets, local environment files or full private Git history are published.

```text
8b9b2abf3f11180f9394446500687dc7fee406ca 2026-09-23T08:01:50Z Move settlement rail to X Layer testnet
0feca681aa6ea5e8bb3da8c18e02767af4c0286b 2026-09-23T09:15:34Z Add xStocks basket with on-chain Proof of NAV
c3016cf16393ca1532439253f91ceef7b4ca7573 2026-09-23T09:41:34Z Add keyless contract verification export
4cb6dc94d306449552898884f9447b3dfa81a528 2026-09-23T10:51:59Z Deploy settlement contracts to X Layer testnet
a8ea5f2b0af186a53530d4d1b36cf684527f5458 2026-09-23T11:05:31Z Deploy the relayer and app to Cloudflare Workers
b8586424f549dd4d46d2cfaec1d4489d4410893b 2026-09-23T11:06:25Z Pace xstocks:check calls to the trial OnchainOS rate limit
f730252dae6187e221e8586a2d5af142a47ac057 2026-09-23T11:10:09Z Record the X Layer deployment in the Dev Day notes
a79bb78b60de31737ede0723c65d4c5c2bb7eead 2026-09-23T11:17:11Z Record the first on-chain GMD US TECH x NAV
f6f333e53c6cd6d84ea859d4db3e283eebb63af1 2026-09-23T11:27:43Z Note explorer source verification in the Dev Day notes
911af9119fdd266e3f0f2599eaf01ab319eb8b8d 2026-09-23T20:38:30+09:00 Merge pull request #2 from mycyi1994-hash/claude/korean-query-6agq3t
f35288c2b893ca389d3a874d626b962d5ae23a27 2026-09-23T21:11:17+09:00 Refine Ganymede navigation, strategy cards and NAV presentation
a6a3a26451a1a67d09964bab308acd05faa5937e 2026-09-23T21:43:04+09:00 Clarify strategy details, paper estimates and NAV evidence
c74dc696fbeedeb2b611ab38026184e71c08caee 2026-09-23T22:08:47+09:00 Refine paper portfolio layout and data availability states
3aa286aaf774a4d488ef2551d1c2737126e953b8 2026-09-23T22:26:26+09:00 Keep primary navigation consistent across all public screens
8222b591bed948695b7be56e78687eaaf3b5ac88 2026-09-23T23:28:57+09:00 Focus submission design on tokenized stock NAV evidence
c98e7eab02f5ce97d250d583a0772e180d2843a5 2026-09-24T00:21:30+09:00 Keep public reads free of writes and preserve NAV evidence through outages
27350f287a7066549079771f0f09e4db4b722415 2026-09-24T00:21:30+09:00 Verify NAV directly in the browser and separate record validity from pricing freshness
e5d1d8f5213d89addb6ed43b97568c491d7c6015 2026-09-24T03:09:20+09:00 Redesign Ganymede with the Clearform visual system
5f2fff8cbd475fb0b771a18272c81efc5012cff7 2026-09-24T09:58:10+09:00 Preserve deployed identity boundary while restoring Clearform
1ff54638f0449990180c45417870599a925441bc 2026-09-24T10:13:16+09:00 Isolate paper portfolios by private browser session
5af1ea0796cab77be6aaaa1d7b01d9a8b24cd8b2 2026-09-24T10:20:43+09:00 Focus the product journey on USTX composition and NAV evidence
4641ddc8248f563c60cf4b1a7dfdb71af7828b8a 2026-09-24T10:31:33+09:00 Demonstrate real NAV verification failures on a local document copy
9e6d3eeae8f37bc66bbcb6b9d3ae323d4cb7c9cd 2026-09-24T10:33:12+09:00 Keep verification experiment stable during background refresh
95da39e64f005ffd6b806ac63eef6f6b49bba114 2026-09-24T10:56:27+09:00 Align submission documentation with verified product behavior
28e0ce2ddfabaa87ebdc73007a37d84460bdfa46 2026-09-24T11:04:32+09:00 Patch application dependencies and document submission access requirements
```

Publication adjustments: AGENTS.md is review-specific; .openai/hosting.json uses a placeholder project ID; relayer/wrangler.jsonc uses a separate example Worker name and placeholder D1 ID; README and submission notes reference this snapshot. No app, lib, contracts, tests or lockfile changes were made for publication.


## Review journey and publication correction

Source 41de09d adds the report-first navigation and Overview verification, two
explicitly synthetic report profiles, publication/quote-policy status, and exact
registry evidence for stale publication retries. It also serializes submissions
and reconciles known transaction receipts. The public repository now contains
an inspectable diff from its previous snapshot; no private history is required
to inspect these changes.

Validation: application build and 51 tests; relayer typecheck and 5 lifecycle
tests. Production verification passes 3/3; a local $1 edit fails both checks and
restoration passes. Ten public page routes returned 200. These are point-in-time
observations, not continuous availability or a security audit.

Application deployment: 91eba3cc-00d7-4d2a-8050-4c9daa01e827.
Relayer deployment: a9cf2c42-f4d8-48f2-8a3c-d167a03437f5.


## Five-stage journey release

Production source: e8631c26ca9f6b384c32604c96bd0e3b92955111. Worker version: 19417a86-37cf-4f6f-9d51-2c6c71426ac5. The private main now integrates the journey and Claude review changes. This export includes the same implementation, with review-only deployment identifiers preserved. See JOURNEY_RELEASE.md for checks and limitations.


## Review, product and accessibility releases

Production source: f0ae49ce3f410af6cfcab9d3e2ff4e3a85aa4d68. Worker version: 6e8ba126-42e0-4114-b355-77275a4bcd98, deployed 2026-09-24 10:37 UTC. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93. This snapshot is exported from 7a138e5c327d3b338674721fd5b416338fe85531, which adds only release documentation to the production source.

Releases since the previous snapshot:

- df6c41e97f0668c9066f0b77d8e9d88fc9f0fca2 → b287ab71-66f9-45d0-8854-3ee28626f2c0: a review of the whole codebase fixed defects in the paper ledger (input bounds, share reservation, conditional settlement, forward pricing, cash shortfalls, on-chain eligibility), USTX publication (request budget, retry classification, reconciliation of unresolved publications, bounded storage and provider cooldowns, composition checks), the relayer (status codes, product scope, retried mints, nonce resync, error bodies) and the interface. Each defect was reproduced before it was fixed; the new tests fail on the previous source.
- ff0492005341b62bb0c6acddc28a6ecd4a781cbb → bb33af8d-0c01-4c7e-ac20-0853854bfb74, then 1bfed8ec5f65b5b731e3f3b14814786aa3a740ae → 379aa941-a9db-4c61-8169-723bf0553c7a: the product is organized as Markets, the USTX product page, Transparency, and read-only Portfolio and Activity views of the GMDCORE test share ledger; the price-edit experiment and paper strategies moved to Lab, and old routes redirect. Investing and redemption are not implemented: there is no deposit address, settlement token or custody contract.
- f0ae49ce3f410af6cfcab9d3e2ff4e3a85aa4d68 → 6e8ba126-42e0-4114-b355-77275a4bcd98: NAV unit label contrast and landmark structure on the verification page, plus a test-fixture time fix.

Validation of the snapshot source: typecheck, build, lint (0 errors) and 89 tests; relayer typecheck and 16 tests. After the last deployment, public routes returned 200, legacy routes redirected, axe reported no violations on nine pages, 200% and 400% zoom and 320 and 390 px widths showed no horizontal overflow, and NAV publications continued to confirm on X Layer Testnet. These are point-in-time observations, not continuous availability or a security audit.

## Verification-led and Portfolio releases

Production source: d05524681bc0f29fb7f196cd6a465728050f83b6. Worker version: 80d4b272-dfae-4fdf-b404-e15dddf54e15, deployed 2026-09-24 13:50 UTC. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged because the relayer has not changed since the previous snapshot. This snapshot is exported from d409f34fdc167fdd09e1a8ceb80e44ef5b2f5986, which adds only documentation to the production source. Every build-period commit, with times and line counts, is listed in BUILD_PERIOD.md.

Releases since the previous snapshot:

- 333ee0d97023d6e66cc6b26f9eda5b257e3c43a1 → d95963d6-3a81-4c33-8f16-a9e9618371b0, 13:31 UTC.
  - Markets and USTX lead with the browser's own check of the latest record, and the menu is Markets / Verify.
  - The Verify page states what a match confirms and what it does not. It shows the age of the oldest quote and the document retention window.
  - It adds a three-way tamper experiment: change one price; also fix the arithmetic; offset two prices so that every number and the NAV stay the same.
  - A downloadable evidence file is re-checked by `npm run verify:evidence` against the `NavPublished` event in the receipt of the publishing transaction.
  - Chain errors in the public API are replaced by fixed text.
- d05524681bc0f29fb7f196cd6a465728050f83b6 → 80d4b272-dfae-4fdf-b404-e15dddf54e15, 13:50 UTC.
  - A read-only Portfolio reads any wallet's six xStock balances on X Layer mainnet at one block. It values them at the prices of the verified record and offers a downloadable statement and a USTX-weighted basket calculator.
  - The Verify page checks the code, symbol and decimals of the six pinned xStock contracts on X Layer mainnet.
  - The chart covers every publication. Older points are recovered from the `NavPublished` events in the receipts of confirmed publications, separately from publication itself.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 110 tests pass, lint reports 0 errors, and the relayer typecheck and 16 tests pass.
- The same tests pass in this public checkout after `npm ci`.
- After the last deployment:
  - nine public routes returned 200 and the legacy routes redirected;
  - the browser check matched and all six xStock contracts matched;
  - the three experiment edits gave the intended results;
  - an evidence file for the 13:50:17 UTC record passed `verify:evidence` against its X Layer Testnet transaction;
  - axe reported no violations.

These are point-in-time observations, not continuous availability or a security audit.


## Chart record count release

Production source: a65d6d79951eebd8a48ce97b489bdb40e28134b8. Worker version: cabd72ed-5134-4df3-aa21-534d16a74449, deployed 2026-09-24 14:16 UTC. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 345ea3dfd28f64075d1ea252e99392dfb28d5f79, which adds only documentation to the production source.

- a65d6d79951eebd8a48ce97b489bdb40e28134b8 → cabd72ed-5134-4df3-aa21-534d16a74449: the public API thins the stored NAV series to about 300 points for the chart. The chart note counted the points it drew, so after 300 publications it would have understated the number of records. The API now also returns the stored count. The note states that count and, when fewer points are drawn, how many are shown.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 111 tests pass, and lint reports 0 errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployment:
  - nine public routes returned 200 and the legacy routes redirected;
  - the browser check matched and all six xStock contracts matched;
  - the chart note equalled the API count;
  - the three experiment edits gave the intended results;
  - an evidence file for the 14:15:17 UTC record passed `verify:evidence` against its X Layer Testnet transaction;
  - axe reported no violations;
  - there was no horizontal overflow at 200% or 400% zoom, or at 320 or 390 px.

These are point-in-time observations, not continuous availability or a security audit.


## Demo investing and fund product releases

Production source: 23d35d25a115befab184ccc68e96f6e54f311f0d. Worker version: bebf23c3-427f-4bdf-b521-6ead2b86b7d6, deployed 2026-09-24 18:38 UTC. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 38cbdc18b598a61b6ad5dd65b5856b986f42b6d7, which adds only documentation to the production source.

- 1327a6af74602a74867c21ff50c7d5e769a7ccd4 → 7be4c726-55a8-4685-badc-57f94587849e, 18:07 UTC: visitors invest in USTX with demo dollars. Each browser has a private demo account with $10,000, orders fill instantly at the NAV recorded on X Layer in one database transaction with idempotent retries and a daily cap, and Portfolio shows the account. The D1 migration `drizzle/0001_demo_ledger.sql` adds three tables and changes none. No real money moves and no shares are issued on chain.
- 0c3803769033b4e0532b12532683409245711562 → 8fa91c44-04f8-40d5-9bc0-b564dd4e7be3, 18:32 UTC: order confirmations and Portfolio look each holding through to the six xStocks; the USTX page has a fund overview; every NAV record carries the demo shares outstanding; a public NAV API (`/api/v1/ustx`), an embeddable self-verifying badge (`/embed/ustx`) and issuer and developer pages were added.
- 23d35d25a115befab184ccc68e96f6e54f311f0d → bebf23c3-427f-4bdf-b521-6ead2b86b7d6, 18:38 UTC: keyboard focus for the developer page's code samples and a heading for the badge.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 125 tests pass, and lint reports 0 errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployments:
  - eleven public routes and three public APIs returned 200 and the legacy routes redirected;
  - the first record after the fund release (18:35:17 UTC) carried the demo shares outstanding on X Layer;
  - a $250 demo order in a production browser showed the tokens it added to the basket, and Portfolio showed the holding looked through to each xStock;
  - the badge verified the NAV in the browser;
  - axe reported no violations on eleven screens, and there was no horizontal overflow at 200% or 400% zoom, or at 320 or 390 px.

These are point-in-time observations, not continuous availability or a security audit.


## Customer proof page release

Production source: f660dc3f528783f1afc167561b653ad6864bd9df. Worker version: 26694863-3284-4e16-97a9-ad4862b2ea44, deployed 2026-09-25 01:0x UTC. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 65e0625b4adfb13a3a35ecef6da0a19ed7c1aa9f, which adds only documentation to the production source.

- f660dc3f528783f1afc167561b653ad6864bd9df → 26694863-3284-4e16-97a9-ad4862b2ea44: the Verify page is a customer proof page in the manner of an exchange proof of reserves, and the individual checks, the tamper experiment, the evidence file and the original document move to "Verify it yourself" on the developer page. Figures that come from OKX are labelled "Priced by OKX OnchainOS", "OKX price" and "OKX Explorer". The fund overview shows 24-hour flows instead of a public list of single orders, and `/api/demo/fund` returns totals only. The constituents strip no longer overflows its row: a legacy global rule had made its buttons 46px tall inside a 29px row.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 126 tests pass, and lint reports 0 errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployment:
  - eleven public routes and three public APIs returned 200 and the legacy routes redirected;
  - at 1536 px and 125% zoom the strip's buttons were 29px with no clip-path left behind;
  - the proof page showed "NAV verified on X Layer" and the developer page's three checks passed;
  - axe reported no violations on six screens, with no horizontal overflow or page errors.

These are point-in-time observations, not continuous availability or a security audit.


## Service layout release

Production source: cb921f5f2e4221caddf55d54bb8232593fe3d386. Worker version: 3a46801e-e6f9-47e0-af1c-8477f24bef71, deployed 2026-09-25. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from a5b0df09ba7a223c658969231324e45371597e1a, which adds only documentation to the production source.

- The screens are laid out like a live service: one testnet notice inside the header with the network and a "Connect OKX Wallet" button; Markets without the pitch sections; on the USTX page only the order panel beside the chart, the price oracle and last NAV record in the fund facts, one factsheet-style holdings table and "About USTX"; demo-balance wording instead of repeated warnings; no basket calculator; issuer plans with contact instead of planned prices and a roadmap. The visual design is unchanged.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 126 tests pass, and lint reports 0 errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployment, eleven public routes and three public APIs returned 200, the legacy routes redirected, and seven screens on desktop (1536 px, 125%) and mobile (390 px) had no axe violations, horizontal overflow or page errors.

These are point-in-time observations, not continuous availability or a security audit.


## Wallet investing release

Production source: 10dee7aa57eb64a322090d0cd4a7b848ef14e19b. Worker version: f760cd9e-bf95-47a0-8d4d-4a0fa4886c21, deployed 2026-09-25. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 55cb87f573cc4bff5ce1fdbe1cb59b9a9720efac, which adds only documentation to the production source.

- Two contracts on X Layer Testnet (chain 1952), deployed by the administrator key next to the NAV registry and recorded in `onchain/deployments/xlayer-testnet.json`.
  - `GanymedeDemoDollar` (dUSD) `0xf07535080f74e8b0f571e58dfa600f47e72ea9bf`: no-value demo dollars. Anyone can claim 10,000 once a day, and only the fund contract can mint more.
  - `GanymedeBasketFund` (USTX) `0x77eaeba1366bde7818da12d3cbdbea0a2ee97596`: issues and redeems shares only at the latest `us-tech-x` NAV in the registry. The NAV must be at most an hour old and orders at least $10. It rounds down both ways, takes a minimum-output limit and holds no assets. It counts holders on chain, and no key can issue shares directly.
- The order panel offers Wallet next to Demo balance. OKX Wallet connects, switches to X Layer Testnet, claims demo dollars and runs approve and invest (or redeem) as transactions. The fill is read from the contract's event.
- Each NAV record's shares outstanding, the fund size and the investor count add USTX held in wallets to demo-balance shares. Portfolio shows the wallet's USTX looked through to each xStock.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 134 tests pass, lint reports 0 errors, and the 29 contract tests pass. The contract tests pin the app's hard-coded selectors and addresses to the compiled contracts and the deployment record.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- Before the deployment, a local build ran in Chromium with an injected test wallet signing real X Layer Testnet transactions. It went through connect, network switch, a rejected request, approve, invest, Portfolio and a full redemption. Afterwards the fund's supply and investor count were back to zero.
- After the deployment:
  - eleven public routes and three public APIs returned 200 and the legacy routes redirected;
  - the first cycle read the wallet totals from the fund contract and recorded the NAV with no warning;
  - seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors. On production the wallet was only connected and read; no transaction was sent.

These are point-in-time observations, not continuous availability or a security audit.


## NAV feed and lending release

Production source: e36c7a3a925a793c4ea380d510f6fc73258fa6df. Worker version: 6f647815-4665-40fd-b098-9146546f512d, deployed 2026-09-25. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 4545c2c7d2fbbc84b909f4370fe5576370d308c5, which adds only documentation to the production source.

- `GanymedeNavFeed` on X Layer Testnet (chain 1952), `0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8`, deployed by the administrator key and recorded in `onchain/deployments/xlayer-testnet.json` with its creation transaction.
  - It returns the registry's latest `us-tech-x` NAV through `AggregatorV3Interface`, the interface Chainlink price feeds use: 8 decimals, "USTX / USD".
  - The round ID and `updatedAt` are the record's effective time. It has no owner and nothing to configure.
- The developer page gains "Read the NAV from a contract" with a Solidity example, and `GET /api/v1/ustx` returns the feed's address.
- `GanymedeLendingMarket` (demo-dollar loans against USTX at the recorded NAV, with liquidation) is written and tested but not deployed. `npm run fork:lending` runs it against the live testnet contracts on an in-memory fork with no key.
- All five X Layer Testnet contracts are source-verified on the OKX explorer and match exactly on Sourcify (creation and runtime bytecode); `onchain/README.md` lists them.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 134 tests pass, lint reports 0 errors, and the 50 contract tests pass. Deliberate breaks of the lending and feed rules each made the contract tests fail.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. The feed appeared on `/developers` and in `/api/v1/ustx`. Seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors.
- The first cycle after the deployment recorded the NAV effective 2026-09-25 04:46:17 UTC ($99.772334), and the feed's `latestRoundData` returned that value with that time as its round.

These are point-in-time observations, not continuous availability or a security audit.


## USTX market release

Production source: 1e2693b518a1a272cefa07d47d174a2b45baeb7e. Worker version: f460620d-8c77-4584-81d0-92abbf44e748, deployed 2026-09-25. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. This snapshot is exported from 8373527ebb88b1079a922de0b793ab522ed4dcc8, which adds only documentation to the production source.

- Two contracts on X Layer Testnet (chain 1952), deployed by the administrator key and recorded in `onchain/deployments/xlayer-testnet.json` with their creation transactions.
  - `GanymedeUstxPool` `0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1`: a constant-product USTX/dUSD pool with a 0.3% fee to liquidity providers. It was seeded at the NAV with 50.1174 USTX and $5,000 of demo dollars, and opened at $99.765748 against a NAV of $99.765749.
  - `GanymedeNavArbitrage` `0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9`: closes the pool's gap to the NAV through the fund in one transaction. Below the NAV it buys in the pool and redeems at the fund; above it, it invests at the fund and sells in the pool. It reverts unless the caller gets back more than it put in.
  - Both match exactly on Sourcify (creation and runtime bytecode).
- A live arbitrage with a throwaway test wallet: a seller pushed the pool 17.3% below the NAV, then `buyAndRedeem` put in $447.82 and got back $491.80 (transaction `0x3c604c934a1ef7576a173e0b513c419ad89376f1c6bea17464f8c5afbb9f6c2e`), leaving the pool 0.27% below the NAV, inside the fee.
- The USTX fund overview shows the pool's market price and its premium or discount to the NAV. The developer page gains "Trade USTX on X Layer", and `GET /api/v1/ustx` returns the pool and arbitrage addresses.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 135 tests pass, lint reports 0 errors, and the 60 contract tests pass. Deliberate breaks of 11 pool and arbitrage rules each made the contract tests fail.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 16 tests.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. The USTX page's market price read "$99.49 · 0.27% below NAV". Seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors. The first cycle after the deployment recorded the NAV at 05:16 UTC with the pool's USTX in the shares outstanding.

These are point-in-time observations, not continuous availability or a security audit.

## Arbitrage keeper release

Production source: 1e0465f26ae1276e8d0e9fb653535c7d68e22ed3. Worker version: b203515c-1232-4301-a9f6-6db509f13575, deployed 2026-09-25 after 09816f8c-cbcd-458d-8a19-2e1bf14c28ba and e7c29424-d4f4-4dfe-8815-824f3747bc1f the same morning. Relayer Worker version: cb38524c-cb75-4350-a9ee-a363f49a5c93, unchanged. New keeper Worker `ganymede-arbitrage-keeper`: version 0f36c825-08fd-4aa7-ab82-9c0947343458 from source f7d7c986141e62e4f19a16411c4828ea1daf36d3, whose keeper code is unchanged in the production source. This snapshot is exported from f9828dd93ab0a599d858be76c20a7318f5ab3db6, which adds only documentation to the production source.

- An arbitrage keeper, `relayer/src/keeper.ts` with `relayer/wrangler.keeper.jsonc`, is a second Worker with its own key (a Worker secret) and no role on any contract. The wallet `0xccf372068496d9bef0f7cf83d697183d358dec1b` holds only testnet OKB for gas and no-value demo dollars.
  - Every five minutes, three minutes past each mark so that the app's NAV record for the mark has landed, it asks `GanymedeNavArbitrage.quote()` for the trade that closes the USTX pool's gap to the NAV.
  - It trades only when closing the gap earns at least a cent. It runs the trade as a call first and skips it if the call reverts. It insists on half the profit the call showed, and quotes again after it claims demo dollars or approves the arbitrage contract.
- The first release's first trade, a $1.83 `buyAndRedeem`, reverted with `Unprofitable(1834955, 1834943)` (transaction `0x56437e76bde092960bd1967526922b21e2176b1d2d9fba6434a655fd62977941`): the app's NAV record for 06:05 UTC landed between the keeper's quote and its trade. The contract's no-loss rule held and only gas was spent. The schedule, the call-first check and the one-cent minimum above came from that run.
- A live run with a throwaway test wallet: a sale left the pool 6.02% below the NAV (transaction `0xb467547f88971d511199fbaf1e21d68c264bccfe3be6d5b9d60cf2aa1e727ff4`). At 06:23 UTC the keeper's scheduled run put in $145.92 and got back $150.30 (transaction `0xbec5c89a1546e65c1f03a4131c85c1ef50e1ac9e3f4e6e09f929b33f7c33d26f`), leaving the pool 0.29% below the NAV, inside the 0.3% fee.
- The developer page states the keeper's rule and links that trade and the keeper wallet. `GET /api/v1/ustx` returns the wallet as `market.keeper`.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 135 tests pass and lint reports 0 errors. The relayer typecheck and 28 tests pass; 12 of the tests cover the keeper, including a skipped trade whose call reverts and the decoding of the real revert data. A run with writes refused, against live X Layer Testnet and the keeper's own address, returned call results and a decoded `Unprofitable(500000000, 454840736)`.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.
- After each deployment, the main public routes and APIs returned 200 and the legacy routes redirected. On b203515c, seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors.

These are point-in-time observations, not continuous availability or a security audit.

## Lending market deployment

Production source: 1e0465f26ae1276e8d0e9fb653535c7d68e22ed3, unchanged: no Worker was deployed. This snapshot is exported from 92815027b4a924392370e23d7b72ae63b642cf5e, which adds to the production source the lending deployment record, the updated deploy script and documentation; application code is unchanged.

- `GanymedeLendingMarket` is deployed on X Layer Testnet at `0xae2f54ae3d0370295de18510d56de92afb8843c7` (creation transaction `0xb771847aebe5f893eec25e97f99c69cc55f0f85fcaa71217facab2bd7df26278`), next to the recorded dUSD and USTX fund, by the administrator key, with the user's approval. It lends demo dollars against USTX valued at the fund's `currentNav()`.
- It is paused: nothing can be supplied, posted or borrowed until the administrator calls `unpause()`, which has not been done. It is not in the app.
- `onchain/scripts/deploy-lending.ts` now sets its own nonce and gas limit and waits for the receipt, and the record carries the creation transaction. The contract matches exactly on Sourcify (creation and runtime bytecode); the OKX explorer upload files are in `onchain/deployments/verification/xlayer-testnet/`.

Validation of the snapshot source:

- In the development repository, the contract typecheck and 60 contract tests pass. The deploy script ran first on a local fork of X Layer Testnet with a key holding no real funds, and `npm run fork:lending` ran supply, collateral bought at the live NAV, a loan, a 30% lower NAV, liquidation with the 8% bonus, redemption of the seized USTX at the fund, repayment and withdrawal against the live contracts in memory, broadcasting nothing.
- After the deployment, the chain returned the expected dUSD, fund and administrator addresses and `paused = true`.
- The application and relayer tests pass in this public checkout after `npm ci`.

These are point-in-time observations, not continuous availability or a security audit.

## Best-price routing release

Production source: 73d543f4cdfcced41c76df3a148360c6730b839e. Worker version: 5d7eebbc-b2c4-49fa-b7c1-23fe78270fb8, deployed 2026-09-25; prior b203515c-1232-4301-a9f6-6db509f13575. Relayer and keeper Workers unchanged. This snapshot is exported from 4aa5d6b5e62ee41b88f81a3a183040bc6a46d912, which adds only documentation to the production source.

- The USTX wallet order panel quotes each order at both venues and routes it to the one that gives more, marked "Best price"; the visitor can pick the other.
  - The fund, at the NAV recorded on X Layer, with no fee.
  - The USTX/dUSD pool, at its price after the 0.3% fee and the order's own price impact, computed with the pool's own integer arithmetic.
- Pool orders approve demo dollars (buying) or USTX (selling) to the pool, then call `buy` or `sell`. They take a 1% minimum and a ten-minute deadline counted from the chain's clock, and the fill is read from the pool's `Bought` or `Sold` event. The pool still trades while the fund waits for a NAV record.
- The lending market's source is now verified on the OKX explorer too, so all eight X Layer Testnet contracts are verified there and match exactly on Sourcify.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 140 tests pass, lint reports 0 errors, and the 61 contract tests pass. One contract test sends the app's own calldata, unchanged, to pool bytecode placed at the pinned pool address, and checks the app's quotes against `quoteBuy` and `quoteSell`.
- A throwaway test wallet traded through the interface on X Layer Testnet, on a local build and then on production. Its allowances to the pool were first set to zero. A $20 purchase in the pool (approve, then buy) and a full sale (approve, then sell) each completed without page errors.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. Seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Lending market release

Production source: 0d989a74f56272427cfd9bfc02b6d7ef100cf93d. Worker version: de3e16c9-b6bd-4fe3-a025-7de5d3eb38a5, deployed 2026-09-25; prior 5d7eebbc-b2c4-49fa-b7c1-23fe78270fb8. Relayer and keeper Workers unchanged. This snapshot is exported from 7e785de61eddbe48922a036ed4ef16c696811d12, which adds only documentation to the production source.

- `GanymedeLendingMarket` (`0xae2f54ae3d0370295de18510d56de92afb8843c7`) is live on X Layer Testnet. With the user's approval, the administrator unpaused it after simulating the call (transaction `0x1acb998775cb55926d585611f9cc18171ab63015b86b62927828d237af6a873f`, `npm run activate:lending`). A throwaway test wallet supplied the first $5,000 of demo dollars (transaction `0xaae154df99a842a354c832fbaefff5fdadaf5ae0538fdb3408b0dce1a5ea67af`).
- The USTX page's Borrow section, from OKX Wallet:
  - Market figures read at one block.
  - The wallet's position at the recorded NAV, computed with the contract's rounding.
  - Deposit USTX, borrow, repay, withdraw USTX, lend and withdraw demo dollars. Each action is approved as needed, simulated, sent and read back from the market's event.
  - What can be borrowed or withdrawn leaves 0.1% of the debt for the interest accrued until the transaction is mined.
- The developer page shows how to use USTX as collateral, and `GET /api/v1/ustx` returns the market.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 146 tests pass, lint reports 0 errors, and the 62 contract tests pass. One contract test places the market's bytecode and constructor state at the pinned address and runs a full cycle with the app's own calldata, including the app's maximum borrow and withdrawal after an hour of interest.
- A throwaway test wallet ran the same cycle through the interface on X Layer Testnet, on a local build and then on production: 2.003298 USTX deposited, $20 borrowed at a 10.00% loan to value, repaid in full and the USTX withdrawn. It saw fresh figures after each step and no page errors.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. Seven screens on desktop and mobile, with and without a wallet, had no axe violations, horizontal overflow or page errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Portfolio lending release

Production source: 3211c6fbdd93bbc5ac09d1a24b08c9eab228b3a2. Worker version: 15ae856c-d433-4f10-a3c1-deb825c170b8, deployed 2026-09-25; prior 5f124eee-407a-4a12-bbb6-483f8c5642aa, and before it de3e16c9-b6bd-4fe3-a025-7de5d3eb38a5. Relayer and keeper Workers unchanged. This snapshot is exported from fba33e4d68ff029e7d46e1b10ef7514dc0b67ca3, which adds only documentation to the production source.

- Portfolio's wallet section also reads the lending market.
  - USTX posted as collateral gets its own row: its value, borrow limit, the loan with its loan to value, and a link to manage it.
  - Demo dollars the wallet lends are named below the rows.
  - The look-through covers the wallet's USTX plus its collateral.
- Rates under 0.01% a year read as such instead of 0.00%.
- A throwaway test wallet keeps 1 USTX posted and $10 borrowed as a live example (transaction `0x4f761f4dccfd65054c68c6aa961dd5e91f2800e7cadfe6179664dbd3cb06f018`). Liquidation would need the NAV to fall more than 84.6%.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 146 tests pass, lint reports 0 errors, and the 62 contract tests pass.
- On production, Portfolio for the test wallet showed 1.003298 USTX in the wallet and 1.000000 USTX as collateral, with a $10.00 loan at 10.00% of its value, and looked through both. There was no overflow or page error on desktop or mobile.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. Seven screens on desktop and mobile, with and without a wallet, had no axe violations.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Market activity release

Production source: 852d53e64c25ee4e0999f97514cbc6569e56d867. Worker version: afb8f68a-8b18-4eba-80d5-a731e76d1528, deployed 2026-09-25; prior 15ae856c-d433-4f10-a3c1-deb825c170b8. Relayer and keeper Workers unchanged. This snapshot is exported from ab843ec4c7b77b97b8123cce7af50c7420d60995, which adds only documentation to the production source.

- The USTX page lists the market's latest events from X Layer Testnet, each linked to its transaction on the OKX explorer.
  - Investments and redemptions at the NAV.
  - Pool trades, with their price.
  - The keeper's arbitrage as one row, with what it earned.
  - Every lending step.
- The public RPC answers at most 100 blocks per log request and X Layer makes a block a second. A scheduled job on the app Worker's second cron (`4-59/5 * * * *`, apart from the NAV cycle) reads new blocks, then history back to the fund's deployment, and keeps the latest 40 rows.
- `GET /api/v1/ustx/activity` serves those rows read-only with open CORS. The page reads only the blocks since, so a visitor's own order appears within seconds.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 154 tests pass (8 new, one of them calling the built Worker's scheduled handler with the new cron), lint reports 0 errors, and the 62 contract tests pass. The contract tests read a real arbitrage and a lending cycle back through the app's decoder.
- Reading every market log since launch on X Layer Testnet gave 45 rows; each of the four keeper arbitrages became one row.
- On a local build, a throwaway test wallet bought $20 of USTX in the pool and sold it back; each trade appeared at the top of the list, as "You", within seconds.
- On production, the first scheduled run finished ok and the API began serving rows; NAV records stayed on the five-minute marks. The main public routes and APIs returned 200 and the legacy routes redirected. Seven screens on desktop and mobile, with and without a wallet, had no axe violations.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Markets activity release

Production source: 6e3e143b5e29c69404ec234893e89275e59f95c0. Worker version: 90840b50-7f9d-4d8a-ab70-c9040b9f61f2, deployed 2026-09-25; prior afb8f68a-8b18-4eba-80d5-a731e76d1528. Relayer and keeper Workers unchanged. This snapshot is exported from bdd638fbdf718183f0d2abe0e55d9dea7f6b31fa, which adds only documentation to the production source.

- Markets shows the last 24 hours of the USTX market and its four latest trades, linking to the full list on the USTX page, which shows the same figures.
  - Volume of orders at the fund and in the pool.
  - Trades, and keeper arbitrage runs with what they earned.
  - Loan actions.
- The scheduled index keeps 200 rows, more than a day of activity, and `GET /api/v1/ustx/activity` serves the latest 40 with the day's figures. The figures say when they are not yet complete, and count from the oldest row they hold.
- The index never claims blocks whose rows it dropped. An index stored under the earlier 40-row limit reads again below its oldest row; production's had been cut at 40, and the first run of this version began reading that part again.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 156 tests pass, lint reports 0 errors, and the 62 contract tests pass.
- On a local build, a throwaway test wallet bought $20 of USTX in the pool and sold it back; within seconds of each fill the 24-hour trade count and volume rose by that trade, on the USTX page and on Markets.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. Seven screens on desktop and mobile, with and without a wallet, had no axe violations.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Product detail release

Production source: a20712fbc950aaf06c1f19b5f7a259be0b400f15. Worker version: 5225c560-1d20-48e7-9e52-a61ae7b79979, deployed 2026-09-25; prior 90840b50-7f9d-4d8a-ab70-c9040b9f61f2. Relayer and keeper Workers unchanged. This snapshot is exported from 206120625a3fb53efde0b92cc39b232f0e55b92e, which adds only documentation to the production source.

- Each xStock row shows its OKX price, its change since the units were fixed and its weight against the equal-weight target, and opens a detail panel (a sheet on phones): the tokens in a share and in the whole fund, its part of the NAV, its fixing price, and its token contract on X Layer mainnet. The fixing price is recovered from the units, which were fixed as the NAV at the fixing times the weight over the price.
- The NAV counts down to the next five-minute record, reads the market again once it is due, and flashes green or red when a new record arrives; reduced motion turns the animation off.
- The fund overview shows the pool's price against the NAV on one gauge with the pool's 0.3% fee band. Borrow and Portfolio mark a loan against its 50% borrow limit and 65% liquidation line.
- The NAV chart has a crosshair tooltip and marks the keeper's arbitrage and orders of $1,000 or more. `GET /api/v1/ustx/activity` serves them as `highlights`, read only from the stored index.
- First reads show placeholders; refreshes keep what is shown. Portfolio shows the value in each xStock as a donut with a full legend.
- The six asset colours now pass a colour-blind separation check as a ring, and every chart names each asset in text.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 160 tests pass, lint reports 0 errors, and the 62 contract tests pass.
- On a local build reading the production market data, seven screens on desktop and mobile, with and without a wallet, had no axe violations, nor did the open detail panel; placeholders gave way to data, and a simulated new record flashed the NAV.
- After the deployment, the main public routes and APIs returned 200 and the legacy routes redirected. The same seven screens, the open detail panel and Portfolio for a public test address had no axe violations.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Submission tidy release

Production source: ba59333137fdf4290e8ab1f05c784f92083df684. Worker version: ae1dae8a-29c8-4a30-90b8-bf39503cafb5, deployed 2026-09-25; prior 5225c560-1d20-48e7-9e52-a61ae7b79979. Relayer and keeper Workers unchanged. This snapshot is exported from a1f9e3ca495bddb15b38c3b681307529e980cb13, which adds only documentation to the production source.

- The OKX Dev Day rules allow existing projects and ask them for the list of new work and its commits, so every statement that Ganymede existed before the event stays.
- Files nothing used are removed: four July social images with the earlier "Ganymede Index" branding, three starter-template icons and the starter's D1 example. The package takes the project's name instead of the starter template's.
- The reuse is stated exactly. USTX records its NAV to the pre-event NAV registry contract, redeployed to X Layer Testnet without changes, through the settlement relayer, which was extended for X Layer, and uses the same fixed-point helpers; the earlier engine's strategies run only the separate paper Lab, while its five-minute cycle and D1 state store also run the USTX step added in the build period. The README, BUILD_PERIOD.md and OKX_DEV_DAY.md say the same.

Validation of the snapshot source:

- In the development repository, the typecheck, clean build and 160 tests pass, and lint reports 0 errors.
- After the deployment, the main public routes and APIs returned 200, the legacy routes redirected, and the removed files returned 404. Seven screens on desktop and mobile, with and without a wallet, had no axe violations.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## NAV recovery release

Production source: fd465594405ac6896b9eb40d28cffa74023940b1. Worker version: 28351ac7-ee9f-4b72-b926-9e26c229a283, deployed 2026-09-25; prior ae1dae8a-29c8-4a30-90b8-bf39503cafb5. Relayer and keeper Workers unchanged. This snapshot is exported from 2a9e3444f6abae9a8719605e4b5b7431a95a8b9f, which adds only documentation, screenshots and a test to the production source.

- From 14:10 UTC on 25 September, Cloudflare stopped the scheduled engine cycle at about 10 ms of CPU time, the per-invocation limit of the Workers Free plan; the same version had run that cycle at 100–170 ms until 14:05. No USTX NAV was recorded from 14:01 to 14:45 UTC. The fund and the lending market refuse a NAV older than one hour, so wallet orders and loans would have stopped at 15:01.
- The five-minute cron now runs the USTX step alone under the engine's lease (`runUstxNavCycle`); the earlier engine's paper strategies run through the operator API. The NAV series appends new points without rebuilding and re-sorting the stored week.
- The reuse statements now say that the USTX step uses the earlier engine's D1 state store and job lease, and ran inside the engine's own five-minute cycle until 25 September.
- The README opens with five screenshots of the production site in `docs/images/`: Markets, the USTX page, an xStock's detail panel, a wallet's Portfolio look-through and the Transparency check.

Validation of the snapshot source:

- In the development repository, the typecheck and 161 tests pass, including a check that appending to the series gives the same result as a full merge, and lint reports 0 errors.
- After the deployment, the 14:45, 14:50 and 14:55 UTC crons succeeded and recorded the NAV at 14:45:56, 14:50:54 and 14:55:54.
- At 16:00 UTC, a production end-to-end run with a test wallet bought and sold USTX in the pool, invested and redeemed through the fund, and deposited, borrowed, repaid and withdrew in the lending market; each transaction appeared at the top of the market activity within seconds, with no page errors.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Freshness release

Production source: 6bcee813f43f1dd65a13d269bbee78868e84648c. Worker version: 014ecc17-08dd-4289-9cf1-a4fe5f1168d1, deployed 2026-09-25; prior 28351ac7-ee9f-4b72-b926-9e26c229a283. Relayer and keeper Workers unchanged. This snapshot is exported from 089d1bbdab435bf5c469547490e613adce0ee6c3, which adds only documentation to the production source.

This release answers a second review of the submission.

- A NAV record carries the time it was calculated, and the fund and the lending market accept it for an hour after that. With the earlier 360-minute quote limit, prices stamped at 11:00 could have been recorded as a 16:00 NAV. OnchainOS stamps each quote with the time of its response, and in production the price time is about a second after the calculation, so the default limit is now ten minutes, two cycles. A test covers the reviewed case: prices stamped at 11:00 with a NAV calculated at 16:00 are blocked, as are prices eleven minutes old, and prices thirty seconds old publish.
- The fund size shows how many shares are USTX tokens in wallets, which trade in the pool and serve as loan collateral, and how many are in demo balances, which stay in the app. The X Layer record counts both.
- The README now states that a publisher recording wrong prices in a consistent document passes every check, and that the testnet fund burns and mints demo dollars without holding xStocks. It compares one USTX order with buying the six xStocks separately, using measured gas, and gives the measured unit cost of recording a basket every five minutes on X Layer: about $1.40 of gas a month at 0.02 gwei.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 162 tests pass, and lint reports 0 errors. On a local build reading the production data, the fund overview had no horizontal overflow on desktop or phone.
- After the deployment, the public API reported a ten-minute quote limit, the first record at 16:40:54 UTC was confirmed with no blockers, the main routes returned 200 and the legacy routes redirected.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Second price source, second basket and in-kind vault release

Production source: 75e919753f78e3cbb78f8aa5886491a2775ea8d1. Worker version: 4011ca58-6d7f-4b5a-9040-9886f4a40fa2, deployed 2026-09-25; prior a11671f0-2fc9-420e-b458-ad66da1a9731, and before it, on the same day, f9be1c59, cdc2a6f6, 3bbe9250, eb7c548c and a23ce053 after 014ecc17. Relayer and keeper Workers unchanged. This snapshot is exported from 7095bd237b7476db10376440c68d6aface762e48, which adds only documentation to the production source.

This release answers a third review of the submission, eleven items, and two review rounds on the result.

- A second price source. Before each record, the publisher values the basket at the Uniswap V3 pools on X Layer mainnet where the xStocks' ERC-4626 wrappers trade, each pool confirmed by the factory and each wrapper by its xStock, and does not record a NAV more than 1% from that value; if the pools cannot be read, the record goes ahead with a warning. The Transparency page repeats the comparison in the browser, and the public API names the pools and the rule.
- Record times. A record's time is its oldest price, and the NAV is calculated after the prices arrive. Prices quoted more than a minute apart block the record; the browser and `npm run verify:evidence` reject a price more than a minute older than the record time and a record time more than a minute after its block. The public API adds `calculatedAt` and `validUntil`.
- Rate limits. The price API answers 429 with Cloudflare's "error code: 1015", counted per egress IP. A limited request is asked again 30 and 90 seconds later in the same cycle, then at the next cycle, and a long cycle renews its job lease before writing.
- A second basket from one configuration file. MAG3 (AAPLx, MSFTx, NVDAx) is recorded by a demo issuer wallet, separate from Ganymede's keys, in its own `GanymedeNavRegistry` at 0xf412ba3857f63f513b93c4a8e3cacc1f162daa60 on X Layer Testnet (exact Sourcify match), priced from the X Layer pools with `npm run basket:publish`. The developer page checks its latest record with USTX's checks plus a check of its configured units, weights and fixing time, and `/embed/basket?config=/baskets/mag3/basket.json` is its badge.
- An in-kind vault. `contracts/GanymedeBasketVault.sol` creates shares only against delivery of the constituents and redeems them for a proportional share of the holdings, so an xStock dividend or fee paid through its balance multiplier reaches the holders. `npm run fork:vault` bought real AAPLx, MSFTx and NVDAx on their pools on a fork of X Layer mainnet, created 10 shares and redeemed them from two accounts (`docs/IN_KIND_VAULT.md`). It is not deployed.
- The issuer page gives a pilot's scope and the measured running cost, About USTX compares one order with buying the six xStocks separately, and the public API splits the recorded shares into wallet tokens and demo balances.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 180 tests pass, and lint reports 0 errors; the relayer typecheck and 28 tests pass; the contract suite's 69 tests pass.
- After the final deployment, 16 main routes returned 200 and the 4 legacy routes redirected. Transparency showed "NAV verified on X Layer" with the pools agreeing within 0.03%; MAG3 and its badge verified in the browser; axe reported no violations on six changed screens at desktop and phone widths; with a test wallet, a $10 fund investment and redemption and a lending cycle (deposit, borrow, repay, withdraw) succeeded with no page errors; a production evidence file passed `npm run verify:evidence`. NAV records at 18:40, 18:45, 18:50, 18:55 and 19:00 UTC were confirmed.
- The same tests pass in this public checkout after `npm ci`, and so do the relayer typecheck and 28 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Finalist-round release: Pools and a Uniswap v4 pool held at the NAV

Production source: 12ac2bd1065172ff649fcd298d1a8636f2687d4e. Exported commit: f43358b937f2adffd2565acdd6618df3241c88a0 (documentation after the source). Worker version: 2344d4ba-3abe-4728-9909-a92461b6565b, deployed 2026-10-02; before it 05a89f80-eb1a-4dfa-ae86-d980c8f311c1 and 13f4722c-a8f2-46ea-9f89-e7b7f5ed8279 the same day and aa00645d-8693-4cd6-97e7-b67f59720fca the day before. Arbitrage keeper Worker: 5e23f598-a074-45ee-ac07-b7bd622e9092.

This work was done after the 17–25 September build period, as one of the 30 finalists; the organizers confirmed the latest version may be presented. docs/BUILD_PERIOD.md lists it apart from the build period.

- Pools: the USTX/dUSD pool's value at the NAV, 24-hour volume and fees, fee APR and price against the NAV, and adding or withdrawing liquidity from a wallet in both tokens or demo dollars alone.
- `GanymedeRwaLiquidityHook`, a Uniswap v4 hook that runs a second USTX/dUSD pool around the NAV, and `GanymedeV4Router`, deployed with Uniswap v4-core 1.0.2's PoolManager on X Layer Testnet (hook 0x96a78af00ef351f294f2ccc05adf09b119f968c0) and seeded with $5,000 of USTX and $5,000 of demo dollars. The hook moves the pool to each NAV record before trading, prices deposits at the next record and charges a fee that rises from 0.30% to 1.00% as the record ages; the keeper re-pegs it at each record.
- Pools compares both pools over the same NAV records: what each pool's trades made or lost for its providers, valued at the NAV in effect, read from the contracts' events. Before release, over the first 256 records, the keeper's three arbitrage trades took $0.0505 from the constant-product pool's providers, the sum the keeper earned, and nothing from the v4 pool's, which had no other trades in that time.
- The USTX wallet order panel quotes the fund, the constant-product pool and the v4 pool (through the router's dry run) and routes each order to whichever gives the most.
- Market activity lists the v4 pool's trades through its router and its deposits and withdrawals, on Markets, the USTX page and the v4 pool's view in Pools.
- Invariant fuzzing of the hook against Uniswap's compiled PoolManager (1,000 random steps passed) and a Slither 0.11.6 pass over every contract, each High and Medium finding triaged in docs/STATIC_ANALYSIS.md; no contract changed as a result.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 214 tests pass, and lint reports 0 errors; the relayer typecheck and 30 tests pass; the contract suite's 99 tests pass.
- After the final deployment, the main routes returned 200 and the 4 legacy routes redirected; in a browser on production a $25 order was quoted at all three venues and the v4 review opened with no page errors; the NAV record kept being confirmed every five minutes, and the keeper re-pegged the v4 pool at each record.
- The same tests pass in this public checkout after `npm ci` (214), and so do the relayer typecheck and 30 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Finalist-round release: AI agents, Ask USTX and a load test

Production source: 4ee593f458e318520a60f648050b3472f2a3a33f. Exported commit: 62278b4000136093386084fc84600059981c335b (documentation after the source). Worker version: f36d6853-bd9f-48b6-80df-e6a6b943e6b2, deployed 2026-10-02; before it, the same day, 9f11ebdb-adae-41fa-a1c1-9fa470b7b2a0, 84aa2810-e425-420a-9120-0c2463f9e915 and c9b926f1-1e40-466d-90fd-82ca843f7c87. The keeper is unchanged (5e23f598-a074-45ee-ac07-b7bd622e9092).

- An MCP server at `/mcp` (Streamable HTTP, no key or session) with six read-only tools: the latest NAV and whether orders accept it, the record checked against its document, the holdings behind a share, a quote at the fund and both pools, the pools and their results for providers, and the market's activity. The developer page shows how to add it to an AI client.
- Ask USTX, an assistant on every product screen: an OpenAI model that reads X Layer only through those tools, names the tools behind each answer, gives no investment advice and keeps the demo labels, limited per visitor and per day.
- A load test with 30 team test wallets on X Layer Testnet: 618 transactions across every wallet flow, none failed; 90 wrong orders refused with the contracts' own errors; a browser with a test wallet ran the order, borrow and liquidity screens on production; 1,198 page, API and MCP requests had no errors while every NAV record landed on time. The wallets are the team's, not users; docs/LOAD_TEST.md lists them. The test found a preload of a script the build never wrote, fixed in this release.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 227 tests pass, and lint reports 0 errors; the contract suite's 99 tests pass.
- After the final deployment, the main routes returned 200 and the legacy routes redirected; every asset the pages name loaded; a browser visit on production logged no page, console or HTTP errors; `/mcp` answered `initialize`, `tools/list` and every tool.
- The same tests pass in this public checkout after `npm ci` (227), and so do the relayer typecheck and 30 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Finalist-round update: a faster pools API

Production source: ca2b504d5b4ccae501617a2c620f7b114f3c38a4. Exported commit: cce55e19e885d02d8a275360d6f09217ddf2ff06 (documentation after the source). Worker version: e7625a3a-2897-47a0-9935-0a24b37cc650, deployed 2026-10-03; before it ecc85508-002a-4ac2-85a1-92a738891508 the same day and f36d6853-bd9f-48b6-80df-e6a6b943e6b2 the day before. The keeper is unchanged (5e23f598-a074-45ee-ac07-b7bd622e9092).

- `GET /api/v1/ustx/pools` and the MCP pools tool took 2.6 s at the median in the load test because each request read both pools from X Layer. A third cron now reads both pools every minute and stores them in the engine state; the API serves that read while it is under 90 seconds old, each server instance keeps what it served for 30 seconds, and X Layer is read for a request only when the snapshot is older. When X Layer cannot be read, a read up to 10 minutes old is served with `stale: true`. Every response says when X Layer was read (`readAt`). Public requests still never write to the database.
- On production after the change, 40 requests to the pools API all answered within 0.6 s (0.17 s at the median) and the MCP pools tool in 0.16 s; the NAV record and the activity index kept running every five minutes.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 230 tests pass, and lint reports 0 errors.
- After the deployment, the new cron registered but did not run until its triggers were deployed again; from then on it ran every minute. The main routes returned 200 and the legacy routes redirected.
- The same tests pass in this public checkout after `npm ci` (230), and so do the relayer typecheck and 30 tests.

These are point-in-time observations, not continuous availability or a security audit.

## Finalist-round update: nine xStocks, six funds and the judge review

Production source: 93213843b7e04420594a94c38260705d5c589716. Exported commit: 9e796dbc65fa9ee09f3c083106ce82fc4639fafa (documentation after the source). Worker version: 26d603cf-f5ac-46b6-b0fd-5b935a0fcb2d, deployed 2026-10-04; the releases since the last snapshot were a95ca225-fdc1-4b63-b52a-2dfc093e39ab (NAV snapshot, paper Lab retired), 7e06c522-9b1d-4c4d-9f71-2dd3995bc86d (streaming Ask USTX), 3d2fbad1-448a-45be-8bb3-5df7d9879d44 (product audit), 39034594-c226-4ea8-8450-4bc1290ba6d3 and ed1b3b00-d721-48c3-8e27-bae21aeb389c (judge review), 44d05068-c3b8-45f1-ac29-b99a886d50f0 and d3c08668-b9fd-4f61-960e-c3ad2aa6fada (nine xStocks), 2974906b-c909-4d8e-a32a-b25cdaf97b33, 627ddb17-bfe1-4fdf-b5d8-1e9a8df85cac and 26d603cf-f5ac-46b6-b0fd-5b935a0fcb2d (six funds). The keeper is unchanged (5e23f598-a074-45ee-ac07-b7bd622e9092).

- The public NAV API answers from a snapshot taken every minute; the earlier won-denominated paper Lab and the GMDCORE test ledger left the public site, which shows US dollars only; Ask USTX streams its answers.
- Who controls each contract, read in the browser on Transparency; SECURITY.md; invariant fuzzing of the lending market; one-click test OKB for a wallet that has none; "Open in the OKX app"; hourly OKX OnchainOS DEX aggregator quotes for building the basket by hand; usage counted without the team's 35 known wallets; an OpenAPI description, llms.txt and a runnable MCP agent example.
- USTX tracks nine xStocks: Alphabet, Oracle and Palantir joined on 4 October, each the same xStocks token contract as AAPLx with a pool on X Layer about as deep as AAPLx's. The basket re-fixed at the prevailing NAV (US$99.8144 before, US$99.8139 after, five minutes apart), and the rebalance record is on X Layer.
- Five more funds over 18 xStocks (Magnificent 7, AI & Semiconductors, Crypto Economy, US Core Index, Retail Favorites), each priced by OnchainOS in the same five-minute run, recorded under its own product key in the same registry, verified in the browser on its own page, and bought with the demo balance. Only USTX has a share token, because the demo dollar has a single minter, the USTX fund.

Validation of the snapshot source:

- In the development repository, the typecheck, a clean build and 250 tests pass, and lint reports 0 errors; the contract suite's 100 tests pass.
- After the deployments, the first nine-stock record and each new fund's first record were confirmed on X Layer with no warnings; on desktop and phone every fund page showed "NAV verified on X Layer", with no accessibility violations, horizontal overflow or console errors; the main routes returned 200 and the legacy routes redirected.
- The same tests pass in this public checkout after `npm ci` (250), and so do the relayer typecheck and 30 tests.

These are point-in-time observations, not continuous availability or a security audit.


## Customer pricing and in-place fund selection — 4 October 2026

Production source: `b45516dcae1a9305e99a8a5f0f4470b42956a61e`. App Worker version: `f790388d-62a5-47c5-99fa-2f8caa5f33d8`; prior version: `4166b71d-5294-42d9-abe4-0ffc8695962a`. Settlement relayer remains `cb38524c-cb75-4350-a9ee-a363f49a5c93`. Exported revision: `bc0c388be08eabfeab46b66a6ad0cc5f3ad16150` (application code matches production; release documentation is newer).

Fund names update the Markets preview in place, and separate arrows open fund details. Customer price comparison separates OKX prices, pool prices and browser arithmetic. Multi-fund portfolio totals, reset consistency, fund-specific verification and recoverable order retries are included. Publication timestamps are matched to the registry's seconds precision without accepting a different second, NAV or document hash.

Validation of production source: 260 application tests, typecheck and build; lint with 0 errors and 10 existing warnings. Controlled browser checks cover race/failure handling, keyboard operation, WCAG A/AA and 390px layouts. After deployment, seven public routes and four redirects passed; all five additional funds verified against their live X Layer records, and the three-value price comparison completed. A new USTX NAV at 10:20:36 UTC was confirmed after deployment without warnings or blockers. These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 260 application tests; clean relayer `npm ci`, typecheck and all 30 tests passed.


## Fund list alignment — 4 October 2026

Production source: `defa322e08db336eaefef9a56311049666912536`. App Worker version: `59a8155a-4240-409c-a47b-c70ec3b7f57c`; prior version: `96579b3d-f1cc-4438-97d0-1c210f25c903`. Settlement relayer remains `cb38524c-cb75-4350-a9ee-a363f49a5c93`. Exported revision: `70ccee34c9f89b7da142bdc48b6fa42c44068f11` (application code matches production; release documentation is newer).

Markets keeps fund names left aligned with tickers below them after the names became selection buttons. The separate arrows still open the fund pages. This snapshot also includes the latest main's 3,000-wallet lending load test and the correction that counts those test wallets as the team's usage.

Validation: 261 application tests, typecheck and build; lint with 0 errors and 10 existing warnings. Chromium checked all six fund rows at eight widths from 320 to 1832px, including label positions, text and price boundaries, and selection versus detail navigation. The published site passed the same layout checks. These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 261 application tests; clean relayer `npm ci`, typecheck and all 30 tests passed. The first NAV after deployment was confirmed at 10:45:26 UTC without warnings or blockers.


## Income and structured products, liquidity strategies and positions of one's own — 4 October 2026

Production source: `9b03e69f4173e4d2b98aa3f28bb41f1c04a0134c`. App Worker version: `9d5bb6d3-586c-4c95-b7bb-a2a2150eaf27`; prior version: `ffe6868f-5fe6-42e9-8663-c5be0907f1ce`. Arbitrage keeper version: `7c6468c0-a8ed-4057-844e-3f615ca9cfbe`. Settlement relayer remains `cb38524c-cb75-4350-a9ee-a363f49a5c93`. Exported revision: `cde51415bc8fd0220b90509f6a692c83c3998c6c` (application code matches production; release documentation is newer).

This snapshot brings in everything released since the fund list alignment:
- **Income and structured products:** covered-call funds on SPYx and QQQx, and a step-down autocallable note, recorded on X Layer under their own product keys.
- **Markets:** grouped into RWA baskets, Income and Structured, with the note's barrier chart at full width.
- **Ask USTX:** suggestions on every screen.
- **Pools:**
  - Adding liquidity takes one button.
  - Liquidity strategies: Spot, Curve and Spot + Curve split a deposit between the two pooled pools; Bid-Ask and Custom open a position of one's own in a new range pool.
  - One chart shows either your deposit or the whole pools, with Ask USTX for each strategy.
- **Range pool (`GanymedeRangeLiquidityHook`, `0x7964c50943c3ea9338d6653b91b872f147fe28c0`):** a second Uniswap v4 USTX/dUSD pool on X Layer Testnet. Each provider holds bins of their own, shaped Spot, Curve or Bid-Ask.
  - Positions open only within 1% of a fresh NAV.
  - Swaps need a NAV under an hour old and may not move the price more than 5% from it.
  - Closing pays out at any NAV.
- **Range arbitrage (`GanymedeRangeArbitrage`, `0xbe0624ee3d949352498a767f1edbe235de38ca4d`):** brings that pool back to the NAV through the fund. The keeper runs it, and wallet orders route to the pool when it pays the most.

Validation of production source:
- Application: 270 tests, typecheck and build; lint with 0 errors.
- Contracts: 108 tests, including the range hook and the app's own calls against it.
- Relayer and keeper: typecheck and 31 tests.
- A fork rehearsal of the range deployment.
- On X Layer Testnet, a test wallet opened a Bid-Ask position and withdrew everything through the app.
- After deployment, the main routes returned 200 and the legacy routes redirected.

These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 270 application tests; clean relayer `npm ci`, typecheck and all 31 tests passed. The first NAV after deployment was confirmed at 16:30:02 UTC.


## Dev Day simplification and contract audit — 4 October 2026

Production source: `d64177beff13d1dd5d56b1cf7af5cc9288463029`. App Worker version: `b80fc2dc-48ac-4a15-ab78-d382051e00e7`; prior version: `9d5bb6d3-586c-4c95-b7bb-a2a2150eaf27`. Arbitrage keeper version: `7c11331b-1c3a-4bdf-823d-306ebbf8f7b9`. Settlement relayer remains `cb38524c-cb75-4350-a9ee-a363f49a5c93`. Exported revision: `298fcc23bf0c08f705395c4d882421ed0460f3a8` (application code matches production; release documentation is newer).

The screens were simplified for the live demo.
- Repeated status chips, a footer logo strip, a duplicated price cross-check, secondary pictures and extra AI boxes were removed.
- Ask USTX at the top follows the Markets category and product.
- Activity figures name the window they cover.
- Charts measure their width once data arrives, so they stay legible on a phone.

A review of every contract found no fund-loss issue. It confirmed one liveness issue: the range pool's arbitrage reverted where no position lay between the price and the NAV, which could leave the pool stuck. `GanymedeRangeArbitrage` was replaced at `0xa4cc0d50eb9fa78b8615ec264b034006e051cbb4`. The new contract:
- moves the price across such a stretch at no cost;
- stops selling at NAV/(1 − fee);
- checks the fund's dollar token.

The keeper sends that re-centring call. The hook is unchanged. Remaining low-severity limits are listed in `onchain/README.md`.

Validation of production source:
- 270 application tests, typecheck and build; lint with 0 errors.
- 109 contract tests.
- 31 relayer and keeper tests.
- On the published site, a test wallet opened a Bid-Ask position and withdrew everything with no page or console errors.
- The main routes returned 200 and the legacy routes redirected.

These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 270 application tests; clean relayer `npm ci`, typecheck and all 31 tests passed. The first NAV after deployment was confirmed at 17:00:32 UTC.

## Review fixes and the range arbitrage replacement — 6 October 2026

Production source: `0f5a1c6005fa09254fd54ea12c77dbdf4ee21f71`. App Worker version: `9bc037b7-2d0d-4b3c-bb69-3b3a71bf0956`; prior versions: `a01d52fe-2a6a-4786-aa44-af786c0a2770` (review fixes, source `c96a6a2`) and `b80fc2dc-48ac-4a15-ab78-d382051e00e7`. Arbitrage keeper version: `d8398e4c-aab4-4b42-9116-7753bb554f07`; prior versions: `bcdddb2d-c45b-499b-b15f-acb2263a3439` and `7c11331b-1c3a-4bdf-823d-306ebbf8f7b9`. Exported development commit: `8afc79a9d805e1dcde05bc88c0f90267e8bc7490`, which adds only the release record and the build-period record to the production source.

A review of the 3–5 October changes led to these fixes:
- A fund order's id can no longer equal a USTX order's id in the demo ledgers, which could credit fund shares without payment.
- The range pool's arbitrage appears on Markets as the keeper's arbitrage, not as customers' redemptions, and its orders already counted in usage were counted again as the keeper's.
- The autocallable note's settlement survives a refused final record, pays whole micros and refuses bad prices.
- A visitor past their own daily allowance no longer spends the site's allowance for Ask USTX or the test OKB faucet.
- Pools reuses the USTX an unfinished deposit bought when it is tried again.
- The NAV on the USTX page no longer blanks while each refresh is checked.

`GanymedeRangeArbitrage` was replaced with the user's approval at `0x58571aa0519a82f1d3839cae5392dfb060c5d572`. Where the pool pays less than the fund needs, it draws the difference from the caller's approved demo dollars. Selling, that is the rest of the fund's $10 minimum investment, repaid in USTX worth more at the NAV. Buying, it is a rounding remainder of up to a cent. Before, selling into fewer bids than the minimum reverted, and the pool could stay more than 1% from the NAV, where positions cannot open. The keeper approves its demo dollars to the new contract, keeps at least $10 of them, and sends a range arbitrage worth under a cent while the price is more than 0.95% from the NAV. The hook is unchanged.

Validation of production source:
- 278 application tests, typecheck and build; lint with 0 errors.
- 111 contract tests. The new test fails on the replaced contract.
- 34 relayer and keeper tests.
- After the deploys, the crons and the keeper ran without errors, and the keeper approved its demo dollars to the new contract on its first run. Usage returned to 2 outside wallets and 71 actions once the range arbitrage's orders were counted as the keeper's. The main routes returned 200 and the legacy routes redirected.

These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 278 application tests; clean relayer `npm ci`, typecheck and all 34 tests passed. The first NAV cycle after deployment ran at 08:25 UTC with all eight other product records published and no warnings, and the USTX record of 08:30 UTC was confirmed at 08:30:19 UTC.

## Demo balance retired, review items fixed — 6 October 2026

Production source: `0e31e9f8c55f4ff8e2235bba6cd8ac2904f65bc9`. App Worker version: `2a53e4c4-45f2-4fb1-9ca4-f306d343b05b`; prior versions: `dbb9b8a6-8925-42c7-8039-33f7ce24be50` (source `bf2d42e`), `769ca386-bfde-4234-9b7c-cd87a062d333` (source `248b732`), `19bfa116-09c3-4fd2-abc4-f31c53961f74` (source `62cdc5d`), `ee83bad7-3c86-4144-81d4-08b168ccd7d6` (source `c95eed7`) and `9bc037b7-2d0d-4b3c-bb69-3b3a71bf0956`. Arbitrage keeper version: `d8398e4c-aab4-4b42-9116-7753bb554f07`, unchanged. Exported development commit: `0843ab713e75c581aeec8973b33d9bf0f59e79b5`, which adds only the release record and the build-period record to the production source.

Changes in these releases:
- The server's demo balance ($10,000 per browser in a D1 ledger) is retired at the user's request: investing runs only with demo dollars (dUSD) from a wallet on X Layer Testnet, and the other products say investing is not open yet, as they have no share token. `GET /api/fund` serves USTX's wallet shares, holders and last day's orders from the contracts' events.
- Ask USTX answers follow-up questions after long answers; the Pools strategy cards fit their panel; the connected wallet is one line on Portfolio.
- The covered-call chart counts from today's NAV to the call's expiry, so it stays right once the ETF has moved after the call was sold.
- The income products' browser check holds each record to its published terms: a covered call's ETF, volatility, rate, strike rule, premium, holding and rolls; the note's schedule, barriers, payout, and the levels of the fixing, knock-in and observation records it decides. What an earlier record decided is held to the terms, not re-read.
- Pools reads every range position of a wallet, through Multicall3, not the latest 20.
- Ask USTX and the MCP server read every product (`list_funds`, `get_fund`); `/api/v1/funds` names each product's kind, and OpenAPI and llms.txt list nine products.

Checks: `npm test` passed all 266 application tests, `npm run lint` reported no errors, and the onchain suite passed 112 tests. After deployment the 10:54 UTC activity index and the 10:55 UTC NAV records of USTX and all eight other products ran on the new version; twelve pages at two widths returned 200 with no page errors or horizontal overflow; legacy routes redirected; a forged identity header was refused; the three income pages showed the browser check as matched. These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 266 application tests; clean relayer `npm ci`, typecheck and all 34 tests passed.

## Range opens checked against the price seen — 6 October 2026

Production source: `1284a9db50ffe1c51c067c3173ff2c8f0f852e4c`. App Worker version: `35a130d7-d437-4972-946a-cba1ffafe294`; prior version: `2a53e4c4-45f2-4fb1-9ca4-f306d343b05b`. Arbitrage keeper version: `d8398e4c-aab4-4b42-9116-7753bb554f07`, unchanged. Exported development commit: `a5ae0119c5dcc768acac962ea942d1fbf1817626`, which adds only the release record and the build-period record to the production source.

The deployed range hook places a position's bins around the pool's price when the position opens and takes no price limit of its own. Pools now reads the pool's tick again just before the wallet opens and stops the open if it moved more than 30 ticks (about 0.3%) from the tick the provider saw; the USTX already bought stays in the wallet for the next try. A hook that refuses such an open itself is written, tested and rehearsed on a fork, and waits for its deployment on X Layer Testnet.

Checks: `npm test` passed all 267 application tests, `npm run lint` reported no errors, and the onchain suite passed 112 tests. After deployment the 11:24 UTC activity index and the 11:25 UTC NAV records of USTX and all eight other products ran on the new version, legacy routes redirected and a forged identity header was refused. These are point-in-time observations, not continuous availability or a security audit.

Public-snapshot validation: clean `npm ci` and `npm test` passed all 267 application tests; clean relayer `npm ci`, typecheck and all 34 tests passed.

## Income records traced to the records they rest on — 6 October 2026

Production source: `a8b64c357f709bc7b3f986899550746cb2bdb83a`. App Worker version: `d17ec1c8-4957-42f4-8f3b-e0d3d9830ac7`; prior version: `35a130d7-d437-4972-946a-cba1ffafe294`. Arbitrage keeper version: `d8398e4c-aab4-4b42-9116-7753bb554f07`, unchanged. Exported development commit: `01dc2493899713de328d0a07ad09c95e33e47eac`, which adds only the release record and the build-period record to the production source.

A covered call's units after a roll, and a note's fixing levels, knock-in and observations, are decided at earlier records, which a later product page did not have. Each confirmed sale, fixing, knock-in and observation is now archived (`lib/income/transitions.ts`), and no later record is sent before such a record is confirmed. The product page traces the latest record back through them, checks each archived record against the NavPublished event in its own transaction receipt, and fails a record whose position, roll arithmetic or note state does not follow from them. The archives start at each product's first record of 4 October 2026: those documents were rebuilt from the launch code and match their transactions' fingerprints.

Checks: `npm test` passed all 273 application tests, `npm run lint` reported no errors, and the onchain suite passed 113 tests on the change that waits for the range hook's redeploy. After deployment the 12:10 UTC NAV records of USTX and all eight other products ran on the new version, the three income pages showed the browser check as matched against those receipts, twelve pages at two widths returned 200 with no page errors or horizontal overflow, legacy routes redirected and a forged identity header was refused. These are point-in-time observations, not continuous availability or a security audit.

## Range hook redeployed with price limits — 6 October 2026

Production source: `42fd70706296f6ec91107a6afd3255e7adcc7a4d`. App Worker version: `aebb4fb0-ae9c-4834-a405-bfba86c95e14`; prior version: `d17ec1c8-4957-42f4-8f3b-e0d3d9830ac7`. Arbitrage keeper version: `fc0c516b-ae35-46d0-955d-0ed64c260e75`; prior version: `d8398e4c-aab4-4b42-9116-7753bb554f07`. Exported development commit: `05012ba219804711565a1673dafde1e0c00e3fa9`, which adds only the release record and the build-period record to the production source.

The range hook placed a position's bins around the pool's price when the position opened and took no price limit of its own, so a price moved between the wallet's signature and the block could place bins around a price the provider never saw. With the user's approval, a hook whose `open()` takes `minTick` and `maxTick` and reverts with `PriceOutsideLimit` outside them was deployed and seeded on X Layer Testnet (hook `0x79b7985e025dbab36cffbfd82863b4f2f50128c0`, arbitrage `0xf76fa2ff202613556e6f30e3dda130a2fa10c593`), the administrator's seed positions in the old hook were closed (no other wallet held one there), and the app and the keeper were pinned to the new pair. Pools sends the tick the provider saw, give or take 30 (about 0.3%), and still reads the price again just before the wallet opens.

Checks: `npm test` passed all 273 application tests, `npm run lint` reported no errors, the onchain suite passed 113 tests (including the app's pin against the deployment record), the relayer typecheck and 34 tests passed, and a fork rehearsal of the replacement passed. After deployment the keeper's 12:48 UTC run read the new range pool through the new arbitrage, the 12:50 UTC NAV records of USTX and all eight other products ran on the new app version, the Pools page read only the new hook, twelve pages at two widths returned 200 with no page errors or horizontal overflow, legacy routes redirected and a forged identity header was refused. These are point-in-time observations, not continuous availability or a security audit.

## Range positions drawn bin by bin — 6 October 2026

Production source: `317692224769065bcbb298cca49e11ef4901bc93`. App Worker version: `f7c90812-822d-45d3-bd8e-b36f1172c746`; prior version: `aebb4fb0-ae9c-4834-a405-bfba86c95e14`. Arbitrage keeper version: `8b06c04c-efd1-4ca9-84e1-210ea11d8772`; prior version: `fc0c516b-ae35-46d0-955d-0ed64c260e75`. Exported development commit: `a122c7431499524416e74f42cb8dc8f89d31fc67`, which adds only the release record and the build-period record to the production source.

Custom on Pools gains a Draw shape, as on Meteora's DLMM Pro: a bar for every bin of one's own position, painted with the pointer or stepped with the arrow keys, started from a preset, mirrored from one side to the other, and kept by name in the browser. A bar's height is the dollars its bin holds, so the deposit splits between the sides by the bars drawn on each. The range hook takes the drawing through `openCustom`, a `uint16` weight for every bin, lowest price first: each side's amount is shared by its bins' weights, a bin of weight 0 stays empty, and each side with bins needs some weight. With the user's approval, after a fork rehearsal that opened and closed a drawn position, the hook was redeployed and seeded on X Layer Testnet (hook `0x8e489d68cf8cbb9199105e3f0c32fc08936e28c0`, arbitrage `0xaee2ffbb9b3c3dbb5bda350d5df7314978b045dc`), the administrator's seed positions in the replaced hook were closed (no other wallet held one there), and the app and the keeper were pinned to the new pair.

Checks: `npm test` passed all 277 application tests, `npm run lint` reported no errors, the onchain suite passed 116 tests (including the app's own `openCustom` calldata against the compiled hook and the app's pin against the deployment record), and the relayer typecheck and 34 tests passed. After deployment the app's own reader found the new pool at the NAV with its three seed positions, the Pools page requested only the new hook and drew a shape on production, twelve pages at two widths returned 200 with no page errors or horizontal overflow, legacy routes redirected and a forged identity header was refused. X Layer Testnet stopped producing blocks at 14:23:24 UTC (block 42837767), just before the first scheduled runs on the new versions, so the 14:25 UTC NAV records and the keeper's trades were submitted but had not been included when this snapshot was made; the scheduled jobs themselves completed. These are point-in-time observations, not continuous availability or a security audit.

## Range shapes drawn in a grid of blocks — 6 October 2026

Production source: `a81c1815cbc04580fc856a0905ff63a0d4a30f46`. App Worker version: `6cb9748c-da0e-43b9-80fa-8fe50faecdae`; prior version: `f7c90812-822d-45d3-bd8e-b36f1172c746`. The arbitrage keeper (`8b06c04c-efd1-4ca9-84e1-210ea11d8772`) and the contracts are unchanged. Exported development commit: `3a294af0392310e1280fc19e90e2ab06c34daef3`, which adds only the release record and the build-period record to the production source.

Custom on Pools lays out its settings as Meteora's DLMM Pro lays out its price range: the shape is a grid with a column of up to ten blocks for every bin, demo dollars below the price and USTX above it, with the current price over the price line, the bins' prices underneath, and undo and redo. A press fills a column up to the block pressed (the top block again takes it off), a drag paints across the columns, and the arrow keys work on a column. Spot, Curve and Bid-Ask show in the same grid and become one's own shape once a block changes; the range takes presets of ±1, 2, 5 and 10% or a custom reach with its lowest and highest prices; a whole setup is saved by name in the browser. A side drawn empty is not filled, so a drawing on one side opens a one-sided position, and the chart draws one's own position bin by bin at its prices. The range hook already took a weight for every bin, so nothing was redeployed on chain.

Checks: `npm test` passed all 277 application tests, `npm run lint` reported no errors, and the app's range client test against the compiled hook passed. After deployment the grid was drawn, edited, undone, saved and reloaded on the public site at two widths with no page errors or horizontal overflow, twelve pages at two widths returned 200, legacy routes redirected and a forged identity header was refused. X Layer Testnet had produced no block since 14:23:24 UTC (block 42837767) when this snapshot was made, so NAV records and wallet trades were waiting on the chain. These are point-in-time observations, not continuous availability or a security audit.

## Pages reopen for tabs from an earlier build — 6 October 2026

Production source: `9d8c2f8859f53a2f3efc1614681a782aef38bab7`. App Worker version: `44c07952-ae21-4ac7-b92f-7d4d15a37cb1`; prior version: `6cb9748c-da0e-43b9-80fa-8fe50faecdae`. The keeper and the contracts are unchanged. Exported development commit: `9f12d198a288a4e87eeead295829d2a4ec3ef5e3`, which adds only the release record and the build-period record to the production source.

A tab opened before a deploy still asks for the files of its own build, which the new deploy no longer serves, so moving to Pools from such a tab changed the address but left the page blank. A small script in the root layout now listens for Vite's `vite:preloadError` and loads the page the visitor was opening from the server, which hands it the new build, at most once per address a minute.

Checks: `npm test` passed all 278 application tests and `npm run lint` reported no errors. On the public site, a Pools file failed once in a browser reopened `/pools` and drew it, a page with nothing failing did not reload, twelve pages at two widths returned 200 with no page errors or horizontal overflow, legacy routes redirected and a forged identity header was refused. X Layer Testnet resumed producing blocks at 15:50 UTC, but transactions submitted during its stall had not been included when this snapshot was made, so the latest NAV record on chain was still the one from 14:20 UTC. These are point-in-time observations, not continuous availability or a security audit.
