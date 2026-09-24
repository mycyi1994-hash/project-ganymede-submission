# Ganymede × OKX Dev Day 2026

## Submission summary

**Primary track: Build a Market.** Ganymede presents a tokenized-stock basket as a product whose published value can be checked. It prices six modeled xStocks through OKX OnchainOS on X Layer mainnet and publishes a NAV and composition fingerprint on X Layer Testnet. Visitors browse the basket in Markets, follow its NAV history and holdings on the USTX page, and the Transparency page has their browser read the record and recalculate the NAV automatically. Portfolio and Activity read the GMDCORE test share ledger for any public address. A price-edit experiment in Lab demonstrates genuine verification failures. Investing and redemption are not open.

The primary value proposition is easier review of a reported NAV. This is a prototype hypothesis, not a claim of validated demand, customers, custody or regulated fund issuance. A possible next customer is a basket operator needing reproducible reporting; user interviews and distribution validation remain future work.

## Reviewer links

- Markets: https://ganymede-xlayer.gana003.workers.dev/
- USTX: https://ganymede-xlayer.gana003.workers.dev/products/ustx
- Transparency: https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency
- Portfolio and Activity (read-only test share ledger): https://ganymede-xlayer.gana003.workers.dev/portfolio, https://ganymede-xlayer.gana003.workers.dev/activity
- Lab (price-edit experiment and paper strategies): https://ganymede-xlayer.gana003.workers.dev/lab/verification, https://ganymede-xlayer.gana003.workers.dev/lab
- Methodology: https://ganymede-xlayer.gana003.workers.dev/methodology
- Limitations: https://ganymede-xlayer.gana003.workers.dev/limitations
- Source: https://github.com/mycyi1994-hash/project-ganymede-submission
- NAV registry (1952): https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c
- GMDCORE test share ledger (1952, read in Portfolio and Activity; issuer mint/burn, no deposits or payouts): https://web3.okx.com/explorer/x-layer-testnet/address/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59

Old links (`/proof`, `/?app=select`, `/?app=portfolio`, `/etfs/...`) redirect to the matching screens. Use the current publication transaction links in Transparency for evidence. A historical deployment or transaction alone is not a claim of current health.

## Existing project and new work

The earlier codebase provided a crypto strategy engine, fixed-point accounting and settlement infrastructure. The following commits document additions during the event build period. Dates in Git history should be considered alongside the actual diff; deployment alone is not the innovation.

| New work | Evidence commit |
| --- | --- |
| X Layer settlement integration | `8b9b2ab` |
| Six-stock basket, OnchainOS adapter and publication gates | `0feca68` |
| Browser-side direct RPC and NAV checks | `27350f2` |
| Public reads without engine/database writes | `c98e7ea` |
| Clearform interface across public screens | `e5d1d8f` |
| Private browser portfolio isolation | `1ff5463` |
| USTX-focused product journey | `5af1ea0` |
| Real-verifier price-edit experiment | `4641ddc`, `9e6d3ee` |
| Full-code review fixes: paper-ledger integrity, publication retries, relayer hardening, interface defects | `7b18cf9`, `dc66eee`, `8cd427f`, `1e0a6bf`, `df6c41e` |
| Product redesign: Markets, USTX, Transparency, read-only Portfolio and Activity | `f4d67c1`, `ff04920`, `1bfed8e` |

## Evidence aligned with judging

- Innovation and user value: a reproducible operator-to-analyst NAV review workflow, not a novel hashing algorithm.
- Completeness: Markets → product → automatic verification of document, chain record and NAV → read-only test share ledger in Portfolio and Activity, with the deliberate edit and restoration kept in Lab. Investing and redemption are not claimed.
- Technical execution: integer arithmetic, canonical bytes, pinned registry/network, ledger reads that check chain ID, contract code and decimals, failure tests, isolated visitor records.
- Integration and ecosystem contribution: actual OnchainOS prices, X Layer records and reusable verifier source.
- Growth: operator reporting is a proposed use case. No adoption metrics or revenue are asserted.

## Submission items still owned by the team

This separate submission snapshot is published for reviewer access. The original development repository remains private. Source commit identifiers in the evidence table are provenance references, not public history links; see BUILD_EVIDENCE.md.

The official builder kit requires a 2–4 minute public demo, team/track/route details, accessible source and product links, and a final declaration. Video production is deferred at the user's request; no video or submission receipt exists in this work. Confirm the roster, attendance route and eligibility before submitting. No submission or acceptance of terms has been performed here.

Deadline in the kit: 25 September 2026, 23:59 UTC (26 September, 08:59 KST). The kit lists an October 7 finale while the terms list October 6; obtain written organizer clarification before travel planning. Private onboarding instructions were not reviewed.

Sources checked 24 September 2026: [Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit), [Terms](https://www.okx.com/learn/okx-dev-day-terms). Assessment is holistic; no numerical scoring weights are published.

## Limits of the evidence

Tests and sampled public checks do not prove continuous uptime. Publication has previously stalled; freshness and failures must remain visible. Prices are single-source, record consistency is not asset backing, and contracts are unaudited. The wallet is used only to share a public address; approval, rejection and account switching in a real wallet extension were not verified end to end. Activity covers the last 2,000 blocks, not full history. Attribution is recorded in public/ASSET-CREDITS.md.
