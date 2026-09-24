# Ganymede × OKX Dev Day 2026

## Submission summary

**Primary track: Build a Market** (portfolio and market-data tools; investor or issuer tooling).

Ganymede publishes the NAV of GMD USTX, a model basket of six tokenized US tech stocks (AAPLx, MSFTx, NVDAx, AMZNx, METAx, TSLAx). Anyone can verify it without trusting the publisher's server.

- Every five minutes the six xStocks are priced through OKX OnchainOS on X Layer mainnet.
- The NAV and a SHA-256 fingerprint of the full composition document are recorded in a registry on X Layer Testnet.
- A visitor's browser reads that record directly and recalculates the NAV row by row.
- A tamper experiment shows which check catches which kind of change. When every number and the NAV are kept, only the fingerprint on X Layer catches the edit.
- The result can be downloaded as an evidence file that `npm run verify:evidence` re-checks against the publishing transaction.
- A read-only Portfolio values any wallet's real xStocks on X Layer mainnet at those verified prices, with a downloadable statement and a USTX-weighted basket calculator.

**Intended users.** Issuers or operators of tokenized-stock baskets who need to publish a value that others can check, and the investors, analysts and auditors who review it.

**Core integration.** OKX OnchainOS prices are the inputs of every NAV. The X Layer registry is the reference that the browser and the evidence command check against.

**What is not claimed.** This is a prototype. Nothing can be bought, held or redeemed as USTX, and no customers, demand or regulated fund issuance are claimed.

## Reviewer links

- Markets: https://ganymede-xlayer.gana003.workers.dev/
- USTX: https://ganymede-xlayer.gana003.workers.dev/products/ustx
- Verify (automatic check, tamper experiment, evidence download): https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency
- Portfolio (read-only xStocks valuation on X Layer mainnet, basket calculator): https://ganymede-xlayer.gana003.workers.dev/portfolio
- Methodology: https://ganymede-xlayer.gana003.workers.dev/methodology
- Limitations: https://ganymede-xlayer.gana003.workers.dev/limitations
- Source: https://github.com/mycyi1994-hash/project-ganymede-submission
- NAV registry (X Layer Testnet, 1952): https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c

The registry also carries NAV records for the earlier paper strategies under a different product key; the USTX check reads only the USTX key. The legacy GMDCORE test share ledger (`0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59`, supply zero) remains readable at `/activity` but is not part of the product journey. Old links (`/proof`, `/?app=select`, `/?app=portfolio`, `/etfs/...`) redirect. A historical deployment or transaction alone is not a claim of current health.

## Existing project and new work

Ganymede began in July 2026 as a Korean-won crypto strategy engine with Upbit market data and settlement built for the GIWA Sepolia testnet. The last commit before the event was `7a33392` on 30 July. Every commit of the build period, with times and line counts, is in [BUILD_PERIOD.md](BUILD_PERIOD.md). The main pieces:

| New work | Evidence commit |
| --- | --- |
| X Layer settlement integration | `8b9b2ab` |
| Six-stock basket, OnchainOS adapter and publication gates | `0feca68` |
| Browser-side direct RPC and NAV checks | `27350f2` |
| Public reads without engine/database writes | `c98e7ea` |
| Clearform interface across public screens | `e5d1d8f` |
| Real-verifier price-edit experiment | `4641ddc`, `9e6d3ee` |
| Full-code review fixes: paper-ledger integrity, publication retries, relayer hardening, interface defects | `7b18cf9`, `dc66eee`, `8cd427f`, `1e0a6bf`, `df6c41e` |
| Product redesign: Markets, USTX, Transparency | `f4d67c1`, `ff04920`, `1bfed8e` |
| Verification-led screens, three-way tamper experiment, evidence file and command, sanitized public errors | `c0ce112`, `80a0316`, `11829e8`, `124bebe` |
| Read-only xStocks Portfolio at verified prices, mainnet token-contract check, NAV series from receipts | `ebef0fa`, `d055246`, `a65d6d7` |

## Evidence aligned with judging

The official criteria are holistic and unweighted. The evidence behind each one:

- **Innovation.** On-chain NAV exists elsewhere, for example in the DTCC Smart NAV pilot and in Centrifuge. The contribution here is narrower: any visitor reproduces a basket NAV row by row against an X Layer record. The experiment isolates what the chain fingerprint adds, and the result travels as a verifiable file.
- **Product completeness.** Markets → USTX → automatic browser verification → tamper experiment → evidence download → command-line re-check, plus a Portfolio that values real xStocks holdings. Every visible action works. Investing and redemption are not offered and not claimed.
- **User value.** A reviewer can confirm in seconds that a published NAV matches its document and chain record. They can also pass that confirmation on as a file instead of a screenshot.
- **Technical execution.** Integer arithmetic, canonical document bytes, a pinned registry and network, direct RPC reads, receipt-event matching, failure tests (111 application tests, 16 relayer tests) and isolated visitor records.
- **Integration.** Real OnchainOS prices for real xStock tokens on X Layer mainnet, published to and verified against an X Layer registry. The six token contracts and any wallet's balances are read from X Layer mainnet in the browser.
- **Growth and ecosystem.** The registry format, verifier and evidence command are reusable by other basket operators on X Layer. This is a proposed direction; no adoption is claimed.

## Submission items still owned by the team

This separate submission snapshot is published for reviewer access. The original development repository remains private. Source commit identifiers in the evidence table are provenance references, not public history links; see BUILD_EVIDENCE.md.

The official builder kit requires a 2–4 minute demo video, team, track and route details, accessible source and product links, and a final declaration. No video or submission receipt exists in this work. Confirm the roster, attendance route and eligibility before submitting. No submission or acceptance of terms has been performed here.

Deadline in the kit: 25 September 2026, 23:59 UTC (26 September, 08:59 KST). The kit lists an October 7 finale while the terms list October 6; obtain written organizer clarification before travel planning.

Sources checked 24 September 2026: [Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit), [Terms](https://www.okx.com/learn/okx-dev-day-terms), [event page](https://luma.com/l4aq8vii). Assessment is holistic; no numerical scoring weights are published.

## Limits of the evidence

- **Uptime.** Tests and sampled public checks do not prove continuous uptime. Publication has stalled before, so freshness and failures must remain visible.
- **What the check covers.** Prices come from one source. Record consistency is not asset backing. Contracts are unaudited.
- **Document retention.** The service keeps the original documents for the latest 12 publications, about one hour. Older records stay on X Layer, and an evidence file downloaded at the time still verifies against its transaction.
- **Corporate actions.** Dividends and splits are not modelled.
- **Wallet testing.** The optional wallet only shares a public address for Portfolio. Approval, rejection and account switching in a real wallet extension were not verified end to end.

Attribution is recorded in public/ASSET-CREDITS.md.
