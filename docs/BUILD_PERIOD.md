# Build-period work

OKX Dev Day 2026 ran its online build period from 17 to 25 September 2026, and judges assess only the work done in that period. This file separates that work from the earlier codebase. The development history is private, so the commit hashes below are provenance references rather than public links. The public snapshot contains the resulting source.

## Starting point

The last commit before the event was `7a33392` on 30 July 2026, "Add GIWA testnet deployment, verification and settlement relayer". Nothing was committed between then and 23 September. At that point the repository contained:

- a Korean-won crypto strategy engine whose paper portfolios are priced from Upbit market data;
- fixed-point accounting and the D1 database schema;
- fund-share and NAV registry contracts and a settlement relayer, deployed to the GIWA Sepolia testnet with a Dojang verified-address eligibility check.

Those modules still power the separate paper Lab. They are not part of the submission's new work.

## What was built during the event

| Area | New work | Main commits |
| --- | --- | --- |
| X Layer | Moved the settlement rail from GIWA Sepolia to X Layer Testnet; deployed the registry, share ledger and relayer; exported sources for explorer verification | `8b9b2ab`, `4cb6dc9`, `c3016cf`, `a8ea5f2` |
| Tokenized stocks | Six-xStock basket (USTX) priced through OKX OnchainOS on X Layer mainnet, with publication gates; NAV and document fingerprint published every five minutes | `0feca68`, `9562bdb`, `dc66eee` |
| Verification | The browser reads the registry directly and recalculates the NAV; a three-way tamper experiment; a downloadable evidence file and the `verify:evidence` command | `27350f2`, `4641ddc`, `80a0316`, `11829e8` |
| Product | Clearform redesign; Markets, USTX and Verify screens led by the browser check; read-only xStocks Portfolio at verified prices; NAV chart from publication receipts | `e5d1d8f`, `f4d67c1`, `ff04920`, `c0ce112`, `ebef0fa`, `d055246` |
| Investing | Demo investing in USTX with demo dollars: private accounts, instant orders at the NAV recorded on X Layer, idempotent retries and a daily cap; order confirmations and a Portfolio that look through each holding to the six xStocks | `1327a6a`, `0c38037` |
| Fund and ecosystem | Fund overview with size, investors and return since launch; the shares outstanding recorded on X Layer with every NAV; a public NAV API with open CORS, an embeddable self-verifying badge, and issuer and developer pages | `0c38037`, `23d35d2` |
| Hardening | Public reads without writes, identity header gate, relayer retry and nonce handling, paper-ledger integrity, sanitized public errors | `c98e7ea`, `387ec35`, `8cd427f`, `7b18cf9`, `124bebe` |

From `7a33392` to `d0b9ade`: 204 files changed, 19657 insertions(+), 7370 deletions(-).

## Every commit in the build period (UTC)

| Time | Commit | Change | Files | Lines |
| --- | --- | --- | --- | --- |
| 2026-09-23 08:01 | `8b9b2ab` | Move settlement rail to X Layer testnet | 35 | +538 / −284 |
| 2026-09-23 09:15 | `0feca68` | Add xStocks basket with on-chain Proof of NAV | 19 | +1406 / −8 |
| 2026-09-23 09:41 | `c3016cf` | Add keyless contract verification export | 4 | +93 / −10 |
| 2026-09-23 10:51 | `4cb6dc9` | Deploy settlement contracts to X Layer testnet | 6 | +132 / −15 |
| 2026-09-23 11:05 | `a8ea5f2` | Deploy the relayer and app to Cloudflare Workers | 5 | +31 / −9 |
| 2026-09-23 11:06 | `b858642` | Pace xstocks:check calls to the trial OnchainOS rate limit | 1 | +15 / −2 |
| 2026-09-23 11:10 | `f730252` | Record the X Layer deployment in the Dev Day notes | 1 | +18 / −3 |
| 2026-09-23 11:17 | `a79bb78` | Record the first on-chain GMD US TECH x NAV | 1 | +1 / −1 |
| 2026-09-23 11:27 | `f6f333e` | Note explorer source verification in the Dev Day notes | 1 | +2 / −1 |
| 2026-09-23 12:11 | `f35288c` | Refine Ganymede navigation, strategy cards and NAV presentation | 11 | +506 / −47 |
| 2026-09-23 12:26 | `e89edae` | Keep the last published NAV on screen when a pricing pass fails | 2 | +9 / −4 |
| 2026-09-23 12:26 | `fcd2d43` | State what the price gate actually checks | 4 | +12 / −5 |
| 2026-09-23 12:40 | `387ec35` | Ignore the identity header unless the platform sets it | 5 | +60 / −3 |
| 2026-09-23 12:40 | `3a03be3` | Seed the database once per cycle, not on every request | 4 | +3 / −4 |
| 2026-09-23 12:40 | `9562bdb` | Retry a rate-limited OnchainOS price request once | 2 | +54 / −3 |
| 2026-09-23 12:43 | `372ee5d` | Make the root typecheck and lint pass on the whole tree | 4 | +11 / −3 |
| 2026-09-23 12:43 | `5ef2fa1` | Test the relayer's request mapping and revert handling | 3 | +76 / −0 |
| 2026-09-23 12:43 | `a6a3a26` | Clarify strategy details, paper estimates and NAV evidence | 7 | +376 / −169 |
| 2026-09-23 12:44 | `12dcccf` | Note D1's free-tier write limit in the deploy instructions | 1 | +4 / −0 |
| 2026-09-23 13:08 | `c74dc69` | Refine paper portfolio layout and data availability states | 8 | +322 / −113 |
| 2026-09-23 13:26 | `3aa286a` | Keep primary navigation consistent across all public screens | 8 | +620 / −539 |
| 2026-09-23 14:28 | `8222b59` | Focus submission design on tokenized stock NAV evidence | 9 | +197 / −108 |
| 2026-09-23 15:21 | `27350f2` | Verify NAV directly in the browser and separate record validity from pricing freshness | 8 | +278 / −57 |
| 2026-09-23 15:21 | `c98e7ea` | Keep public reads free of writes and preserve NAV evidence through outages | 16 | +285 / −60 |
| 2026-09-23 18:09 | `e5d1d8f` | Redesign Ganymede with the Clearform visual system | 30 | +5815 / −2084 |
| 2026-09-24 00:58 | `5f2fff8` | Preserve deployed identity boundary while restoring Clearform | 4 | +56 / −2 |
| 2026-09-24 01:13 | `1ff5463` | Isolate paper portfolios by private browser session | 8 | +152 / −16 |
| 2026-09-24 01:20 | `5af1ea0` | Focus the product journey on USTX composition and NAV evidence | 8 | +115 / −26 |
| 2026-09-24 01:31 | `4641ddc` | Demonstrate real NAV verification failures on a local document copy | 6 | +106 / −2 |
| 2026-09-24 01:33 | `9e6d3ee` | Keep verification experiment stable during background refresh | 2 | +10 / −2 |
| 2026-09-24 01:56 | `95da39e` | Align submission documentation with verified product behavior | 9 | +256 / −206 |
| 2026-09-24 02:04 | `28e0ce2` | Patch application dependencies and document submission access requirements | 5 | +799 / −1195 |
| 2026-09-24 03:10 | `41de09d` | Focus NAV review journey and require exact publication evidence on retries | 27 | +735 / −232 |
| 2026-09-24 03:18 | `4ac37eb` | Record refinement release evidence and remaining browser validation limits | 2 | +50 / −0 |
| 2026-09-24 05:50 | `772a9dd` | Remove five stylesheets that nothing imports | 5 | +0 / −2542 |
| 2026-09-24 05:55 | `2fe87fb` | Restore word gaps in display headings | 1 | +4 / −0 |
| 2026-09-24 05:59 | `baf81c6` | Connect basket understanding, verification experiment and evidence journey | 10 | +141 / −42 |
| 2026-09-24 06:06 | `1e5cbf6` | Describe the stale-publication check in the relayer README | 1 | +10 / −4 |
| 2026-09-24 06:06 | `e8008d8` | Reflow the product panel and price comparison at 320 CSS px | 1 | +8 / −1 |
| 2026-09-24 06:16 | `e8631c2` | Add state-driven journey motion and integrate reviewed release checks | 6 | +80 / −11 |
| 2026-09-24 06:19 | `03fe3ff` | Record deployed journey version and runtime verification | 1 | +13 / −0 |
| 2026-09-24 06:50 | `7b18cf9` | Close the paper ledger's integrity holes found in review | 10 | +796 / −128 |
| 2026-09-24 06:50 | `81a796b` | Drop the headline-only word spacing now that their tracking is looser | 1 | +0 / −2 |
| 2026-09-24 06:52 | `c5a5565` | Refine sculpture motion and group chain record presentation | 2 | +39 / −0 |
| 2026-09-24 06:55 | `dc66eee` | Keep USTX publication evidence accurate through slow or failing relays | 10 | +354 / −47 |
| 2026-09-24 06:58 | `8cd427f` | Harden the relayer's retry, nonce and error handling | 6 | +183 / −19 |
| 2026-09-24 07:08 | `08f41cd` | Define actual product lifecycle and record presentation deployment | 1 | +35 / −0 |
| 2026-09-24 07:27 | `1e0a6bf` | Make the home views, wallet and strategy pages behave as they claim | 12 | +148 / −999 |
| 2026-09-24 07:36 | `df6c41e` | Explain ledger refusals and keep RPC errors out of public health | 7 | +51 / −10 |
| 2026-09-24 08:22 | `f4d67c1` | Rebuild customer product journey and connected design previews | 30 | +1746 / −116 |
| 2026-09-24 09:04 | `ff04920` | Complete product screens and read-only testnet portfolio | 29 | +629 / −89 |
| 2026-09-24 09:08 | `1bfed8e` | Allow clearing a watched public ledger address | 2 | +9 / −3 |
| 2026-09-24 09:11 | `307c03f` | Record final product deployment and production checks | 1 | +12 / −2 |
| 2026-09-24 10:14 | `9ba2f68` | Document complete Codex handoff and submission source gap | 2 | +306 / −0 |
| 2026-09-24 10:23 | `dd7649b` | Stamp publication-test quotes before the cycle, not with the wall clock | 1 | +5 / −1 |
| 2026-09-24 10:26 | `73e2929` | Describe the current product in the README and Dev Day notes | 3 | +121 / −29 |
| 2026-09-24 10:32 | `697f032` | Meet contrast on the NAV unit label and unnest the proof asides | 2 | +4 / −4 |
| 2026-09-24 10:32 | `c6f378a` | Say which commit to export before and after the accessibility fix is deployed | 1 | +3 / −0 |
| 2026-09-24 10:36 | `f0ae49c` | Make the repository guide current for continued development | 2 | +78 / −72 |
| 2026-09-24 10:41 | `be354f4` | Record the accessibility release in the product release notes | 1 | +12 / −2 |
| 2026-09-24 13:10 | `c0ce112` | Lead the product screens with browser verification | 7 | +111 / −62 |
| 2026-09-24 13:17 | `80a0316` | Show what the verification covers and what the chain record adds | 6 | +189 / −7 |
| 2026-09-24 13:21 | `11829e8` | Let anyone take the verification result and re-check it | 8 | +302 / −3 |
| 2026-09-24 13:23 | `124bebe` | Keep upstream RPC error text out of the public proof API | 2 | +24 / −2 |
| 2026-09-24 13:27 | `333ee0d` | Explain the build-period work, project history and prior art | 7 | +220 / −59 |
| 2026-09-24 13:33 | `f65c672` | Record the verification-led release | 1 | +18 / −2 |
| 2026-09-24 13:45 | `ebef0fa` | Value any wallet's xStocks at the verified prices | 13 | +478 / −23 |
| 2026-09-24 13:50 | `d055246` | Chart the NAV since the first publication | 8 | +271 / −3 |
| 2026-09-24 13:56 | `3a8171f` | Record the Portfolio and NAV series release | 4 | +26 / −6 |
| 2026-09-24 14:01 | `678c713` | Refresh the build-period log through the release record | 1 | +2 / −1 |
| 2026-09-24 14:04 | `0fd7322` | Describe the current screens in the release notes | 2 | +14 / −11 |
| 2026-09-24 14:15 | `a65d6d7` | State the full record count when the chart series is thinned | 6 | +38 / −7 |
| 2026-09-24 14:24 | `d255327` | Record the chart-count release and add the submission checklist | 4 | +352 / −7 |
| 2026-09-24 14:31 | `1725c64` | Keep the submission notes accurate after the team submits | 3 | +9 / −6 |
| 2026-09-24 14:38 | `13d69c1` | Keep only confirmed rate-limit events in the checklist | 1 | +2 / −2 |
| 2026-09-24 14:38 | `77a7f63` | Update the submission checklist with the latest production observations | 1 | +7 / −3 |
| 2026-09-24 16:52 | `4de4681` | State the build-period scope in the video script | 1 | +5 / −3 |
| 2026-09-24 17:50 | `1327a6a` | Let visitors invest in USTX with demo dollars | 15 | +767 / −16 |
| 2026-09-24 18:31 | `0c38037` | Show what a USTX share holds, fund figures and partner tools | 26 | +914 / −33 |
| 2026-09-24 18:37 | `23d35d2` | Let keyboard users scroll code samples and give the badge a heading | 4 | +5 / −4 |
| 2026-09-24 18:42 | `9f807c2` | Add demo investing and partner tools to the build-period record | 1 | +11 / −1 |
| 2026-09-24 18:42 | `cbadccd` | Describe the fund product, partner tools and the new releases | 4 | +114 / −46 |
| 2026-09-24 18:44 | `2e17e99` | Update the submission checklist, video script and form text for the fund product | 1 | +90 / −88 |
| 2026-09-24 18:45 | `75980d0` | Bring the build-period record up to the latest commit | 1 | +3 / −1 |
| 2026-09-25 01:02 | `f660dc3` | Make the proof page a customer page, credit OKX data and fix the weight strip | 17 | +203 / −100 |
| 2026-09-25 01:05 | `6a4e7d4` | Bring the build-period record up to the latest commit | 1 | +4 / −1 |
| 2026-09-25 01:05 | `f9ae8f7` | Describe the proof page, the developer checks and 24-hour flows in the docs | 4 | +58 / −35 |
| 2026-09-25 01:27 | `f970e23` | Present Ganymede as a finished service rather than a submission | 11 | +112 / −102 |
| 2026-09-25 01:29 | `cb921f5` | Keep the testnet notice inside the header landmark | 2 | +2 / −3 |
| 2026-09-25 01:33 | `d0b9ade` | Describe the service layout in the docs and record the releases | 5 | +57 / −37 |
