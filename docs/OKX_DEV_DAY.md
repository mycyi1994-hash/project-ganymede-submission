# Ganymede × OKX Dev Day 2026

## Submission summary

**Primary track: Build a Market** (portfolio and market-data tools; investor or issuer tooling).

Ganymede sells USTX, the US Tech Basket: one share holds six tokenized US tech stocks (AAPLx, MSFTx, NVDAx, AMZNx, METAx, TSLAx) on X Layer. Visitors invest from OKX Wallet on X Layer Testnet and receive USTX at the recorded NAV or on the USTX pool, whichever prices the order better, see exactly which tokens their money put in the basket, and verify every price without trusting the publisher's server.

- Investors connect OKX Wallet, get demo dollars (dUSD, no value) on X Layer Testnet, and invest or redeem through the USTX contract, which issues shares only at the NAV in the registry. Without a wallet, a private demo balance of $10,000 fills orders the same way, off chain. The confirmation and the Portfolio look through each holding to the six xStocks.
- The product page shows the fund like a real fund: size (shares outstanding × NAV, both recorded on X Layer), investors, return since launch, key terms, 24-hour flows and look-through holdings.
- Markets shows the market's last 24 hours (volume, trades, keeper arbitrage and what it earned, loan actions) and its latest trades. Market activity on the USTX page lists what happened on chain: investments and redemptions at the NAV, pool trades, the arbitrage keeper closing the pool's gap to the NAV (with what it earned) and every lending step, each linked to its transaction on the OKX explorer.
- Every five minutes the six xStocks are priced through OKX OnchainOS on X Layer mainnet.
- The NAV, the shares outstanding and a SHA-256 fingerprint of the full composition document are recorded in a registry on X Layer Testnet.
- A visitor's browser reads that record directly and recalculates the NAV row by row.
- The Transparency page presents this to customers as a proof page, like an exchange proof of reserves, with every price labelled as coming from OKX OnchainOS. The developer page shows the individual checks.
- A tamper experiment on the developer page shows which check catches which kind of change. When every number and the NAV are kept, only the fingerprint on X Layer catches the edit.
- The result can be downloaded as an evidence file that `npm run verify:evidence` re-checks against the publishing transaction.
- Portfolio shows the wallet's USTX on X Layer Testnet and values any wallet's real xStocks on X Layer mainnet at those verified prices, with a downloadable statement.
- Partners get a public NAV API (`/api/v1/ustx`, open CORS) and a market activity API (`/api/v1/ustx/activity`), an embeddable badge that verifies the NAV in the visitor's browser (`/embed/ustx`), and issuer and developer pages.

**Intended users.** Investors who want tokenized-stock exposure they can check; issuers or operators of tokenized-stock baskets who need to publish a value that others can check; wallets and apps on X Layer that want to show a verified NAV.

**Core integration.** OKX OnchainOS prices are the inputs of every NAV. The X Layer registry is the reference that the browser, the badge, the API and the evidence command check against. OKX Wallet signs the invest and redeem transactions against the USTX contract on X Layer Testnet, which prices every order from the same registry; Portfolio reads X Layer mainnet.

**What is not claimed.** Investing uses demo dollars with no value: no real money moves and nothing is held in custody, and USTX shares on X Layer Testnet carry no rights. No customers, demand or regulated fund issuance are claimed; issuer plans are offered on contact, with no prices claimed.

## Reviewer links

- Markets: https://ganymede-xlayer.gana003.workers.dev/
- USTX: https://ganymede-xlayer.gana003.workers.dev/products/ustx
- Transparency (customer proof page): https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency
- Verify it yourself (the three checks, tamper experiment, evidence download): https://ganymede-xlayer.gana003.workers.dev/developers#verify
- Portfolio (wallet USTX and demo balance with look-through, xStocks valuation on X Layer mainnet): https://ganymede-xlayer.gana003.workers.dev/portfolio
- For issuers: https://ganymede-xlayer.gana003.workers.dev/issuers
- Developers & API: https://ganymede-xlayer.gana003.workers.dev/developers (public API https://ganymede-xlayer.gana003.workers.dev/api/v1/ustx, market activity https://ganymede-xlayer.gana003.workers.dev/api/v1/ustx/activity, badge https://ganymede-xlayer.gana003.workers.dev/embed/ustx)
- Methodology: https://ganymede-xlayer.gana003.workers.dev/methodology
- Limitations: https://ganymede-xlayer.gana003.workers.dev/limitations
- Source: https://github.com/mycyi1994-hash/project-ganymede-submission
- NAV registry (X Layer Testnet, 1952): https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c
- USTX share token (X Layer Testnet): https://web3.okx.com/explorer/x-layer-testnet/address/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596
- dUSD demo dollars (X Layer Testnet, no value): https://web3.okx.com/explorer/x-layer-testnet/address/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf
- USTX NAV feed in the Chainlink `AggregatorV3Interface` (X Layer Testnet): https://web3.okx.com/explorer/x-layer-testnet/address/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8
- USTX/dUSD pool (X Layer Testnet): https://web3.okx.com/explorer/x-layer-testnet/address/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1
- One-transaction NAV arbitrage (X Layer Testnet): https://web3.okx.com/explorer/x-layer-testnet/address/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9, for example https://web3.okx.com/explorer/x-layer-testnet/tx/0x3c604c934a1ef7576a173e0b513c419ad89376f1c6bea17464f8c5afbb9f6c2e
- Arbitrage keeper wallet (X Layer Testnet, testnet OKB and demo dollars only): https://web3.okx.com/explorer/x-layer-testnet/address/0xccf372068496d9bef0f7cf83d697183d358dec1b, for example the trade that closed a 6.02% gap with nobody watching: https://web3.okx.com/explorer/x-layer-testnet/tx/0xbec5c89a1546e65c1f03a4131c85c1ef50e1ac9e3f4e6e09f929b33f7c33d26f
- USTX-collateral lending market (X Layer Testnet, live; borrow from the USTX page): https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7
- Source verification: all eight X Layer Testnet contracts are verified on the OKX explorer and match exactly on Sourcify, for example USTX at https://repo.sourcify.dev/1952/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596

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
| Demo investing in USTX with demo dollars: accounts, orders at the recorded NAV, idempotent retries, daily cap | `1327a6a` |
| Look-through basket, fund overview, shares outstanding on X Layer, public NAV API, embeddable badge, issuer and developer pages | `0c38037`, `23d35d2` |
| Wallet investing on X Layer Testnet: demo dollars and the USTX share contract priced by the registry, wallet order panel, wallet shares in each NAV record | `2fed796`, `7b334e4`, `bc3bf08` |
| USTX-collateral lending market, written and tested, run against the live contracts on a local fork, deployed and activated on X Layer Testnet, with a Borrow section on the USTX page; all four contracts source-verified on the OKX explorer and Sourcify | `8706a43` |
| USTX NAV feed in the Chainlink `AggregatorV3Interface`, deployed on X Layer Testnet and shown on the developer page and in the public API | `beff92f`, `e36c7a3` |
| USTX/dUSD pool and one-transaction NAV arbitrage on X Layer Testnet, with the market price and its gap to the NAV on the USTX page | `ea35938` |

## Evidence aligned with judging

The official criteria are holistic and unweighted. The evidence behind each one:

- **Innovation.** On-chain NAV exists elsewhere, for example in the DTCC Smart NAV pilot and in Centrifuge. The contribution here is narrower: any visitor reproduces a basket NAV row by row against an X Layer record. USTX also trades on its own X Layer pool, and one contract closes the pool's gap to the NAV through the fund, the ETF creation and redemption mechanism in a single transaction, which a keeper checks for every five minutes and runs when it earns at least a cent. The experiment isolates what the chain fingerprint adds, and the result travels as a verifiable file.
- **Product completeness.** Markets → USTX → invest from OKX Wallet on X Layer Testnet (or a demo balance) → see what went into the basket → Portfolio look-through → the Transparency proof page → on the developer page, the individual checks, tamper experiment, evidence download and command-line re-check, plus a Portfolio that values real xStocks holdings. Every visible action works.
- **User value.** An investor buys a diversified tech basket in three taps, sees the exact tokens behind each share, and can confirm in seconds that the price they paid matches its document and chain record, then pass that confirmation on as a file instead of a screenshot.
- **Technical execution.** Integer arithmetic, canonical document bytes, a pinned registry and network, direct RPC reads, receipt-event matching, transactional demo orders with idempotent retries, failure tests (146 application tests, 28 relayer tests, 62 contract tests) and isolated visitor records. Wallet reads are pinned to the newest block seen, and every order is dry-run before the wallet opens.
- **Integration.** Real OnchainOS prices for real xStock tokens on X Layer mainnet, published with the shares outstanding to and verified against an X Layer registry. Wallet orders are X Layer Testnet transactions to a share contract that reads that registry, so the chain enforces the recorded NAV. A feed contract serves the same NAV to other X Layer contracts through the Chainlink `AggregatorV3Interface`. The six token contracts and any wallet's balances are read from X Layer mainnet in the browser, with OKX Wallet connected first.
- **Growth and ecosystem.** Other X Layer apps can show the verified NAV through the public API or the self-verifying badge, and contracts can read it on chain through the Chainlink-style NAV feed. The README sets out the business model (free sandbox, per-basket subscription, distribution fee through licensed partners) and the next steps to X Layer mainnet and an issuer console; the issuer page offers the plans. USTX is also collateral: a lending market on X Layer Testnet lends demo dollars against it at the recorded NAV, and the USTX page borrows, repays and lends through it from OKX Wallet. No adoption is claimed.

## Submission package

This separate submission snapshot is published for reviewer access. The original development repository remains private. Source commit identifiers in the evidence table are provenance references, not public history links; see BUILD_EVIDENCE.md.

The demo video, the team, track and route details, and the final declaration are submitted by the team through the official form. They are not part of this repository.

Sources checked 24 September 2026: [Builder Kit](https://www.okx.com/learn/okx-dev-day-builder-kit), [Terms](https://www.okx.com/learn/okx-dev-day-terms), [event page](https://luma.com/l4aq8vii). Assessment is holistic; no numerical scoring weights are published.

## Limits of the evidence

- **Uptime.** Tests and sampled public checks do not prove continuous uptime. Publication has stalled before, so freshness and failures must remain visible.
- **What the check covers.** Prices come from one source. Record consistency is not asset backing. Contracts are unaudited.
- **Document retention.** The service keeps the original documents for the latest 12 publications, about one hour. Older records stay on X Layer, and an evidence file downloaded at the time still verifies against its transaction.
- **Corporate actions.** Dividends and splits are not modelled.
- **Wallet testing.** The claim, approve, invest and redeem flow ran end to end on X Layer Testnet in a browser with an injected test wallet, including a rejected request. The tests did not drive a real OKX Wallet extension.

Attribution is recorded in public/ASSET-CREDITS.md.
