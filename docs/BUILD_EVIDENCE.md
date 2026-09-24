# Build provenance

Production source revision: `a65d6d79951eebd8a48ce97b489bdb40e28134b8`.

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
