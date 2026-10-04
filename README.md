# Ganymede — a tokenized-stock fund you can verify yourself

Ganymede runs six tokenized-stock funds on X Layer. Its flagship is **USTX, the US Tech Basket**: one share tracks Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla, Alphabet, Oracle and Palantir through their xStocks on X Layer. You invest from OKX Wallet on X Layer Testnet and receive USTX at the recorded NAV, see exactly which tokens your money put in the basket, and check every price yourself. Every five minutes Ganymede prices the xStocks through OKX OnchainOS, records the NAV, the shares outstanding and a SHA-256 fingerprint of the full composition on X Layer, and your browser reads that record directly and recalculates the NAV. The result can be downloaded as an evidence file and re-checked anywhere with one command.

[Markets](https://ganymede-xlayer.gana003.workers.dev/) · [Pools](https://ganymede-xlayer.gana003.workers.dev/pools) · [USTX](https://ganymede-xlayer.gana003.workers.dev/products/ustx) · [Transparency](https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency) · [Portfolio](https://ganymede-xlayer.gana003.workers.dev/portfolio) · [For issuers](https://ganymede-xlayer.gana003.workers.dev/issuers) · [Docs & API](https://ganymede-xlayer.gana003.workers.dev/developers) · [Methodology](https://ganymede-xlayer.gana003.workers.dev/methodology) · [Risks](https://ganymede-xlayer.gana003.workers.dev/limitations)

![Markets: USTX priced by OKX OnchainOS and recorded on X Layer, with the countdown to the next record, the NAV history and the xStocks](docs/images/markets.png)

Investing uses demo dollars with no value. From a wallet, the USTX contract on X Layer Testnet issues shares at the NAV recorded on X Layer; with a demo balance, nothing is issued on chain. No real money moves.

**Built for OKX Dev Day 2026 (Build a Market).** Ganymede existed before the event. The new work of the 17–25 September build period is listed with its commits in [docs/BUILD_PERIOD.md](docs/BUILD_PERIOD.md) and summarized below, apart from the work added since as one of the 30 finalists (Pools and a Uniswap v4 pool held at the NAV).

<table>
<tr>
<td width="50%"><img src="docs/images/ustx.png" alt="The USTX page: NAV history with the keeper's arbitrage and orders of $1,000 or more marked, and the order panel"><br><sub>USTX: the NAV history with the keeper's arbitrage and orders of $1,000 or more marked, and the order panel.</sub></td>
<td width="50%"><img src="docs/images/detail.png" alt="An xStock's detail panel: OKX price, change since the units were fixed, weight against the equal-weight target and its token contract on X Layer mainnet"><br><sub>Each xStock: its OKX price, change since the units were fixed, weight against the target and token contract on X Layer mainnet.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/portfolio.png" alt="Portfolio for a public test address: USTX in the wallet and as lending collateral, looked through to the xStocks"><br><sub>Portfolio: a wallet's USTX and its lending collateral, looked through to the six xStocks.</sub></td>
<td width="50%"><img src="docs/images/transparency.png" alt="Transparency: the visitor's browser checks the NAV against the record on X Layer"><br><sub>Transparency: the visitor's browser checks the NAV against the record on X Layer.</sub></td>
</tr>
</table>

<sub>The production site on 25 September 2026: X Layer Testnet, demo funds with no value.</sub>

## Try it in two minutes

1. **Markets** shows USTX with its latest NAV and a countdown to the next five-minute record, fund size, investors, return since launch, the NAV history with the keeper's arbitrage and orders of $1,000 or more marked on it, and the weights of AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx. Select an xStock for its OKX price, its change since the units were fixed, its weight against the equal-weight target, the tokens in a share and in the whole fund, and its token contract on X Layer mainnet. A status chip reports the check your browser has just run against X Layer.
2. **Invest** on the USTX page. With OKX Wallet: connect, switch to X Layer Testnet, get 10,000 demo dollars (dUSD, no value), approve and invest. The `GanymedeBasketFund` contract reads the latest NAV from the registry and issues USTX to your wallet at that price; redeeming burns USTX and pays demo dollars at the same NAV. Without a wallet, the Demo balance tab gives every browser $10,000 in demo dollars and fills orders the same way, off chain. Either confirmation shows what went into your basket: the amount of each xStock token and its value.
3. **The fund overview** on the same page shows the fund size (shares outstanding × NAV, both recorded on X Layer), investors, return since the $100.00 launch on 23 September 2026, the key terms, 24-hour flows, the pool's price against the NAV on a gauge with the pool's 0.3% fee band, and what all shares hold of each xStock. The Borrow section marks a loan against its 50% borrow limit and 65% liquidation line.
4. **Pools** shows the USTX/dUSD pool: its value at the NAV, 24-hour volume and fees, the fee APR read from the pool's reserves a week apart, and its price against the NAV. With OKX Wallet, add liquidity in both tokens at the pool's ratio, or in demo dollars alone (part is invested at the fund at the NAV first), and withdraw both tokens or have the USTX redeemed at the NAV. A calculator shows what a NAV move does to a deposit against holding both tokens.
5. **Portfolio** shows your demo account: total value, return, your USTX looked through to each xStock in a chart and a table, and your orders. Below it, connect OKX Wallet or paste any public address to see that wallet's USTX on X Layer Testnet and value its real xStock balances on X Layer mainnet at the verified prices, with a downloadable statement. The header's "Connect OKX Wallet" connects the same way. The wallet part is read-only; nothing is signed or sent.
6. **Transparency** is the customer proof page, in the manner of an exchange's proof of reserves. It shows the result of the check your browser runs automatically, how every price is made (priced by OKX OnchainOS, recorded on X Layer, checked in your browser), the holdings, the latest record, recent records with OKX Explorer links and what verification covers.
7. **Developers → Verify it yourself** shows the checks behind it. Your browser reads the pinned registry on X Layer Testnet, hashes the original document and recalculates every holding. Each check is shown with its result.
8. **Try to break it** on the developer page edits a copy of the document in your browser in three ways:
   - change one price: the row arithmetic and the fingerprint fail;
   - also fix the arithmetic: the NAV no longer matches the record;
   - offset two prices so every number and the NAV stay the same: only the fingerprint recorded on X Layer catches the change.
9. **Download evidence** on the developer page saves the document, the record and the publishing transaction. Anyone can re-check it:

```sh
npm ci
npm run verify:evidence -- ustx-evidence.json
```

The command repeats the fingerprint and arithmetic checks against the verifier's pinned deployment. It then reads the transaction receipt from X Layer and requires a matching `NavPublished` event, so a file still verifies after its record is no longer the latest. Add `--offline` to skip the chain read.

Nothing needs a sign-up. Wallet orders are transactions on X Layer Testnet; everything else needs no signature.

## USTX or nine separate xStocks

The same exposure, $1,000 spread equally over the nine xStocks (six until 4 October 2026), measured on X Layer Testnet on 25 September 2026 and priced at X Layer mainnet's gas price then (0.02 gwei, with OKB at $120.49):

| | Nine xStocks bought separately | One USTX order through the fund |
| --- | --- | --- |
| Wallet confirmations to buy | 10 or more: a token approval and nine swaps | 2: an approval and the investment (1 once the approval exists) |
| Wallet confirmations to sell | 9 swaps, plus an approval for each token the first time | 1 redemption |
| Positions to follow | 9 | 1, looked through to the nine on Portfolio |
| Back to equal weight | up to 9 more swaps every quarter | done in the basket at each quarterly re-fixing |
| Price check | each pool's price, separately | one NAV recorded on X Layer and checked in the browser |
| Network fees | nine swaps, estimated hourly by the OKX DEX aggregator (`/api/v1/ustx/dex-quotes`) | investment 75,500 gas and approval 46,200 gas: about $0.0003 |

Network fees on X Layer are a fraction of a cent on either path, so they do not decide the choice; confirmations, positions and rebalancing do. Trading cost is the open question. Each separate swap pays its pool's fee and price impact. The testnet fund pays none because it holds no assets, but a mainnet fund would buy the xStocks and carry those costs itself, netting many orders into fewer trades. The order panel's "Best price" compares what the two USTX routes pay out, the fund at the NAV and the pool after its 0.3% fee and price impact; network fees are paid in OKB and are not part of that comparison.

## For partners

- **Public NAV API.** `GET /api/v1/ustx` returns the latest record read from X Layer at request time: NAV, shares outstanding, fingerprint, transaction and verification links. No key, CORS open to every origin.
- **Market activity API.** `GET /api/v1/ustx/activity` returns the latest 40 market events (orders at the fund, pool trades, the keeper's arbitrage, loans) read from the contracts' logs on X Layer Testnet, with the block range they cover, the last 24 hours' figures, and highlights (every arbitrage and order of $1,000 or more) that the NAV chart marks.
- **Embeddable badge.** `/embed/ustx` is an iframe any site or wallet can show. It verifies the NAV in the visitor's own browser before it says "Verified".
- **A second basket, from one file.** A basket can be defined by a configuration file instead of code (`lib/xstocks/basket-config.ts`): its constituents and fixed units, the registry and product key its records use, and where its documents are served. The browser runs USTX's checks on it and one more, that the document holds exactly the configured units, weights and fixing time. MAG3, a three-stock demo basket, shows it working: a demo issuer wallet we created, separate from Ganymede's keys, deployed its own `GanymedeNavRegistry` ([`0xf412ba3857f63f513b93c4a8e3cacc1f162daa60`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf412ba3857f63f513b93c4a8e3cacc1f162daa60), exact source match on Sourcify) and records MAG3 there with `npm run basket:publish`, priced from the X Layer pools alone, with no API key and no second price source. The [developer page](https://ganymede-xlayer.gana003.workers.dev/developers#baskets) checks its latest record live, and `/embed/basket?config=/baskets/mag3/basket.json` is its badge. MAG3 is recorded by hand, not on a schedule, and issues no shares; its configuration and documents are served from this site's `public/baskets/` folder, so a new record is served after a deploy, and another issuer could serve its documents from its own https host instead.
- **Issuers.** [/issuers](https://ganymede-xlayer.gana003.workers.dev/issuers) explains how another tokenized-stock basket can launch on the same rails, with plans and a contact route. [/developers](https://ganymede-xlayer.gana003.workers.dev/developers) has the API, a viem example that reads the registry directly and the embed code.

## What was built during the event

| Area | New in the build period |
| --- | --- |
| X Layer | Settlement moved from the GIWA Sepolia testnet to X Layer Testnet. NAV registry, share ledger and relayer deployed; sources verified on the explorer. The USTX share token and demo dollars deployed on 25 September |
| Tokenized stocks | Nine-xStock basket priced through OKX OnchainOS on X Layer mainnet. Publication gates reject missing, stale or mismatched quotes. NAV and fingerprint published every five minutes |
| Verification | Direct browser read and recalculation, a mainnet check of the xStock contracts, the three-way tamper experiment, the evidence file and `verify:evidence` |
| Investing | Wallet investing on X Layer Testnet: the order panel quotes the USTX contract at the recorded NAV and the USTX/dUSD pool at its price after fee and price impact, routes each buy or sell to the better one (or the one the visitor picks), and OKX Wallet approves and sends it, with each step, the fill and the explorer link shown. Demo accounts with $10,000 in demo dollars, instant orders at the recorded NAV, idempotent retries and a daily order cap; a confirmation that shows the tokens each order put in the basket; a portfolio that looks through to every xStock |
| Fund | Fund overview with size, investors, return since launch and look-through holdings; the shares outstanding in wallets and demo balances recorded on X Layer with every NAV |
| Market activity | Markets shows the last 24 hours of the USTX market (volume, trades, keeper arbitrage and what it earned, loan actions) and the latest trades; the USTX page lists the market's latest events from X Layer Testnet: investments and redemptions at the NAV, pool trades with their price, the keeper's arbitrage as one row with what it earned, and every lending step, each linked to its transaction. A scheduled job on its own cron reads new blocks every five minutes (the public RPC answers 100 blocks per request) and the page reads the blocks since, so a visitor's own order appears within seconds |
| Portfolio | The wallet's USTX on X Layer Testnet, including any posted as lending collateral with the loan against it and its liquidity in the pool, looked through to each xStock, and valuation of any wallet's xStocks on X Layer mainnet at the verified prices with a downloadable statement |
| Ecosystem | Public NAV API with open CORS, an embeddable self-verifying badge, issuer and developer pages |
| Product | Markets, USTX, Portfolio and Transparency screens laid out like a live service: one testnet notice, network and OKX Wallet in the header, fund facts with the price oracle, factsheet holdings and chart ranges |
| Hardening | Public reads never write, spoofable identity headers ignored, relayer retries reconcile before re-sending, upstream errors kept out of public responses |

Commit-by-commit detail, with times and line counts: [docs/BUILD_PERIOD.md](docs/BUILD_PERIOD.md).

## Since the build period (finalist round)

From 30 September, with the organizers' confirmation that finalists may present the latest version:

| Area | New since the build period |
| --- | --- |
| Liquidity | A Pools screen for the live USTX/dUSD pool: value at the NAV, 24-hour volume and fees from the market activity index, a fee APR measured from the growth of √(USTX × dUSD) per LP token between two blocks, and the price against the NAV. OKX Wallet adds liquidity at the pool's ratio, or from demo dollars alone through the fund, and withdraws it, with every step shown and each quote matched to the pool contract's own arithmetic in tests |
| Uniswap v4 | `GanymedeRwaLiquidityHook`, a Uniswap v4 hook that runs a second USTX/dUSD pool around the NAV: it moves the pool to each NAV record before trading, prices deposits at the next record, charges a fee that rises from 0.30% to 1.00% as the record ages, and holds the liquidity for its depositors. Deployed with `GanymedeV4Router` and Uniswap v4-core's PoolManager on X Layer Testnet, seeded with $10,000, re-pegged by the keeper at each record ([design and run](docs/UNISWAP_V4_LIQUIDITY.md)) |
| Providers against arbitrage | Pools compares both pools over the same NAV records, from the contracts' events: what each pool's trades made or lost for its providers at the NAV. In its first day, the keeper's arbitrage took $0.0505 from the constant-product pool's providers and nothing from the v4 pool's |
| Routing | The USTX wallet order panel quotes the fund at the NAV, the constant-product pool and the v4 pool (through the router's dry run) and routes each order to whichever gives the most |
| AI agents | An MCP server at `/mcp` (Streamable HTTP, no key) lets AI agents, such as an OKX.AI A2MCP client, read the latest NAV, check it against its document, look through a share, quote an order at the fund and both pools, and read the pools and the market's activity. Every tool reads; orders still need the user's own wallet |
| Ask USTX | An assistant on every product screen answers questions about USTX with an OpenAI model that reads X Layer through the same read-only tools as the MCP server, and names the tools behind each answer. It gives no investment advice, keeps the demo labels and has a daily allowance per visitor and for the site |
| Load test | 30 team test wallets ran every wallet flow on X Layer Testnet (618 transactions, none failed; 90 wrong orders refused with the contracts' errors), a browser with a test wallet ran the order, borrow and liquidity screens, and 1,198 page, API and MCP requests had no errors, while every NAV record landed on time ([docs/LOAD_TEST.md](docs/LOAD_TEST.md)). The wallets are the team's, not users |
| Assurance | Invariant fuzzing of the hook against Uniswap's compiled PoolManager (1,000 random steps) and of the lending market (2,000 random steps of lending, borrowing, NAV moves, time and pauses: the books balance, the market stays solvent, no loan opens past its limit, only loans past the threshold are liquidated, a pause never blocks an exit, and everyone can leave), and a Slither pass over every contract with each High and Medium finding triaged ([docs/STATIC_ANALYSIS.md](docs/STATIC_ANALYSIS.md)) |
| Who controls what | The Transparency page reads each contract's administrator, publisher, minter, owner and pause flag from X Layer in the visitor's browser and says what each role can and cannot do; [SECURITY.md](SECURITY.md) has the same inventory, what is trusted, how it is tested and how to report a vulnerability |
| First run | A wallet with almost no test OKB gets 0.0005 (about a hundred transactions) with one click on the USTX, Pools and Borrow screens, once per wallet within daily limits, so a first visitor does not need to find a faucet. On a phone without the extension, "Open in the OKX app" opens the page in the OKX app's browser with OKX Wallet connected |
| OKX DEX comparison | Once an hour the OKX OnchainOS DEX aggregator quotes buying the nine xStocks with $1,000 of USDT on X Layer mainnet; the issuer page shows the swaps, what they lose to price and fees, and the largest price impact, against one order for a fund share (`/api/v1/ustx/dex-quotes`) |
| Nine xStocks | On 4 October 2026 Alphabet (GOOGLx), Oracle (ORCLx) and Palantir (PLTRx) joined the first six. Each is the same xStocks token contract as the others, with a Uniswap V3 pool on X Layer about as deep as AAPLx's (the thinner ones, such as AMDx and NFLXx, were left out). The basket re-fixed to equal ninths at the prevailing NAV, so the NAV continued, and a name being added joins only at the first record with an OnchainOS price for it, so it can never stop the NAV |
| Six funds | Markets lists six funds over 18 xStocks: USTX (nine tech leaders) and five more, Magnificent 7 (M7X), AI & Semiconductors (AIX), Crypto Economy (CRYX), US Core Index (CORX: S&P 500 and Nasdaq-100) and Retail Favorites (RTLX). Every token is the same xStocks contract as AAPLx. Each fund is priced by OnchainOS in the same five-minute run, recorded in the NAV registry under its own product key (keccak256 of its id), checked against the X Layer pools when every holding has a deep one, and verified in the browser on its own page (`/funds/<id>`), where the demo balance buys and redeems it. Only USTX has a share token, pools and lending: dUSD has a single minter, the USTX fund, so a second share token could not pay redemptions without replacing it (`/api/v1/funds`) |
| Usage, honestly counted | `/api/v1/ustx/usage` and the issuer page count every fund, pool and lending event since launch with the team's 105 known wallets (administrator, relayer, keeper, faucet, 100 load-test wallets and an end-to-end wallet) apart, and the questions asked of Ask USTX |
| For developers and agents | An OpenAPI 3.1 description of the public API (`/api/v1/openapi.json`), `/llms.txt` for AI agents, and [examples/agent-quote.mjs](examples/agent-quote.mjs), a dependency-free MCP client that reads the NAV and quotes an order |

## Project history

Ganymede started in July 2026 as a Korean-won crypto strategy engine. Its paper portfolios are priced from Upbit market data, and its fund-share settlement was first built for the GIWA Sepolia testnet with a Dojang verified-address check. That code is still in the repository: its strategies ran a separate paper Lab, which is not part of the submission's new work and was retired from the public site on 3 October 2026 (its links open the dollar product).

For OKX Dev Day we moved settlement to X Layer and built the tokenized-stock product on top of that earlier code. A five-minute cron runs the new USTX step with the earlier engine's D1 state store and job lease (until 25 September it ran inside the engine's own five-minute cycle); it records the NAV to the NAV registry contract from the earlier rail, redeployed to X Layer Testnet without changes, through the settlement relayer, which we extended for X Layer; these reused parts are not counted as new work. The GMDCORE share-ledger contract deployed to X Layer comes from the same rail, so its verified source still describes GIWA settlement. The same X Layer registry also carries NAV records for the earlier paper strategies under a different product key. The USTX check reads only the USTX key.

## OKX integration

| Component | Use |
| --- | --- |
| OKX OnchainOS Market API | Signed price requests for the nine xStock tokens on X Layer mainnet (196). The prices are the inputs of every NAV |
| X Layer mainnet | Where the priced xStock tokens live. The browser reads the nine pinned token contracts (code, symbol, decimals) and any wallet's balances directly |
| X Layer Testnet (1952) | `GanymedeNavRegistry` stores each NAV, the shares outstanding, the effective time and the composition fingerprint and emits `NavPublished`. `GanymedeBasketFund` (USTX) issues and redeems shares only at that NAV, and `GanymedeDemoDollar` (dUSD) pays for them |
| OKX Wallet | `window.okxwallet` first: the USTX page switches it to X Layer Testnet and sends the claim, approve, invest, redeem, pool trade and lending transactions, and the Pools screen its liquidity deposits and withdrawals; Portfolio reads its balances |
| OKX explorer | Every record, token and transaction links to the OKX X Layer explorer |
| Public API and badge | `/api/v1/ustx` and `/embed/ustx` let other X Layer apps show the verified NAV; `/api/v1/ustx/activity` serves the market's latest events; `/api/v1/ustx/pools` the pool's reserves, value, fee APR and last 24 hours; `/mcp` serves the same reads to AI agents over the Model Context Protocol |
| USTX market | `GanymedeUstxPool` is a constant-product USTX/dUSD pool, and `GanymedeNavArbitrage` closes its gap to the NAV through the fund in one transaction, like ETF creation and redemption. A keeper Worker checks the pool every five minutes and sends that trade when closing the gap earns at least a cent; [one such trade](https://web3.okx.com/explorer/x-layer-testnet/tx/0xbec5c89a1546e65c1f03a4131c85c1ef50e1ac9e3f4e6e09f929b33f7c33d26f) closed a 6.02% gap to 0.29%. The USTX page shows the pool price and its premium or discount to the NAV |
| USTX lending | `GanymedeLendingMarket` lends demo dollars against USTX valued at the fund's recorded NAV, up to 50% of it, with liquidation past 65% that the fund's redemption at NAV pays out. The USTX page's Borrow section deposits USTX from OKX Wallet, borrows, repays, withdraws and lends |
| NAV price feed | `GanymedeNavFeed` serves the registry's USTX NAV through `AggregatorV3Interface`, the interface Chainlink price feeds use (8 decimals, "USTX / USD"), so X Layer contracts that read Chainlink prices can read USTX without custom code |
| Browser verifier | Reads the registry over public RPC after checking the chain ID, then verifies exact document bytes and integer arithmetic |
| Evidence command | Re-checks a downloaded file and matches it to the `NavPublished` event in its transaction receipt |
| OKX OnchainOS DEX aggregator | Signed quote requests, hourly, for buying each xStock with USDT on X Layer mainnet, to show what building the basket by hand costs. Quotes only; nothing is sent |
| OKX app | "Open in the OKX app" uses OKX's universal link to open the current page in the app's browser with OKX Wallet |

On X Layer Testnet: NAV registry [`0xf320d2a7f280b7ab61e24374986869d7be34289c`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c), USTX [`0x77eaeba1366bde7818da12d3cbdbea0a2ee97596`](https://web3.okx.com/explorer/x-layer-testnet/address/0x77eaeba1366bde7818da12d3cbdbea0a2ee97596), dUSD [`0xf07535080f74e8b0f571e58dfa600f47e72ea9bf`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf07535080f74e8b0f571e58dfa600f47e72ea9bf), NAV feed [`0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8`](https://web3.okx.com/explorer/x-layer-testnet/address/0x292c56c5290cc7b73e3ee33c2c2688eb3e04c3c8), USTX/dUSD pool [`0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1`](https://web3.okx.com/explorer/x-layer-testnet/address/0x286f5e7ffdbc30db12665d7a3854217d7cd05cc1), NAV arbitrage [`0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9`](https://web3.okx.com/explorer/x-layer-testnet/address/0xaeba15aa92d6f3109e2b992f18933e1abe2fa3d9), lending market [`0xae2f54ae3d0370295de18510d56de92afb8843c7`](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7). Their sources are verified on the OKX explorer and match exactly on Sourcify ([list](onchain/README.md#verify-the-sources)).

## What a match means

A match shows that one published document, its arithmetic and its X Layer record agree, and that the document was not changed after publication. It does **not** show that the prices match the stock market, that anyone holds the tokens, or that the NAV could be realised in real money.

The consistency checks catch changes after publication and arithmetic that does not add up, but not a wrong input, so the prices are also compared with a second source. The recorded prices come from OKX OnchainOS; the second source is the Uniswap V3 pool on X Layer mainnet where each xStock's ERC-4626 wrapper trades against USDG or USDC, read straight from the chain (`lib/xstocks/pool-prices.ts`), with each pool confirmed by the factory and each wrapper by its xStock, converted at the wrapper's rate and counting the stablecoin as $1. Before each record the publisher values the basket at the pool prices and does not record a NAV more than 1% from that value; with six equal weights, one price about 6% wrong moves the NAV that far, while one thin pool moved by a trade usually does not. If the pools cannot be read, the record goes ahead with a warning. The Transparency page repeats the comparison in the visitor's browser. On 25 September 2026 the two sources agreed within 0.3% for every xStock and within 0.05% on the NAV. Both are X Layer markets, so a price wrong in both passes, and neither is compared with the stock exchange.

A record's time is the time of its oldest price, never later than the calculation. OnchainOS stamps each quote with the time of its response, a quote more than ten minutes old blocks the record, and your browser checks that no price in the document is more than a minute older than the record's time. The USTX fund and the lending market accept a record for one hour after that time, so the hour counts from the prices. The NAV feed reports the time as `updatedAt`, and the public API adds the calculation time and the end of that hour.

- **USTX** is a model basket. On X Layer Testnet its contract issues shares for demo dollars at the recorded NAV; it holds no assets, and shares give no rights. An investment's demo dollars are burned and a redemption mints new ones, so no xStock is bought or sold. Demo-balance orders issue nothing on chain. The fund size counts both kinds of shares, and the USTX page shows how many are tokens in wallets, which trade in the pool and serve as loan collateral, and how many are in demo balances, which stay in the app.
- **xStocks** carry the rights their issuer's documents describe. Ganymede does not hold them.
- **GMDCORE** is an issuer-controlled test share ledger from the earlier settlement work. Its supply is zero, and it is not a claim on USTX.
- **Portfolio valuations** price the nine xStocks at the recorded prices. A valuation is not an executable quote and does not prove who controls an address.

Ganymede has no deposit address for real funds and no deployed custody contract; dUSD and USTX exist only on X Layer Testnet and have no value. Contracts are unaudited, and there is no public offering. [Limitations and data policy](https://ganymede-xlayer.gana003.workers.dev/limitations).

## Prior work and what is different

Putting NAV data on chain is not new. The [DTCC Smart NAV pilot](https://www.dtcc.com/insights/2024/smart-nav-pilot-report-bringing-trusted-data-to-the-blockchain-ecosystem) distributed fund NAVs to several chains. [Centrifuge](https://docs.centrifuge.io/user/manager/nav/) managers publish share prices on chain. [Reserve Index DTFs](https://docs.reserve.org/core-components/index-dtfs/overview) already issue and redeem token baskets. [Chainlink Proof of Reserve](https://chain.link/proof-of-reserve) addresses asset backing, a different problem that Ganymede does not solve.

Ganymede's contribution is narrower. Any visitor can reproduce a published basket NAV row by row in their own browser against an X Layer record, see which check catches which kind of change, and hand the result to someone else as a file they can verify independently.

## Business model and next steps (not built)

Ganymede is built to become the verification and distribution layer for tokenized-stock baskets on X Layer. The intended pricing is a free sandbox (today's testnet product), a per-basket subscription for issuers publishing on X Layer mainnet, and a distribution fee on assets raised through licensed partners. The [issuer page](https://ganymede-xlayer.gana003.workers.dev/issuers) lists these plans with a contact route, how Ganymede would earn (a share of the issuer's fee, a distribution share and a verified NAV feed), the road to mainnet (an audit, NAV records on mainnet as a price feed only, a licensed issuer with custody, then distribution) and the usage so far, counted without the team's wallets.

The first thing to sell is the NAV record and its verification to basket issuers; the investing app shows it working. The unit cost is small and measured. One NAV record on X Layer uses about 68,200 gas. At X Layer mainnet's gas price on 25 September 2026 (0.02 gwei) and OKB at $120.49, that is about $0.00016 a record, so a basket recorded every five minutes, 288 times a day, costs about $0.05 a day, or $1.40 a month, in gas. Each record also makes one OnchainOS price request and a few database writes, and one Cloudflare Workers Paid plan ($5 a month) hosts every basket. The costs that grow with each issuer are onboarding, monitoring and support, not chain fees. No customers or prices are claimed.

1. Publish the registry on X Layer mainnet and keep every document in a public archive, so any past record can be verified in the interface.
2. Add a reference from outside X Layer, the underlying shares' exchange price, beside the X Layer pools that already check OnchainOS, and a written policy for corporate actions and constituent changes.
3. An issuer console so other basket operators can launch their own baskets without the command line. A basket is already defined by one configuration file and recorded by its issuer's own wallet and registry, and the browser check and badge work for it (MAG3 above); a public API per basket and scheduled records are not built.
4. With an issuer, custody and legal structure in place, take the USTX token to mainnet behind a vault that holds the xStocks, with rebalancing through OKX DEX. The testnet token already mints and redeems at the verified NAV. The in-kind vault, `GanymedeBasketVault`, is built: on a fork of X Layer mainnet it took real AAPLx, MSFTx and NVDAx bought on their pools, created shares against MAG3's units and paid each redeemer their share of the holdings ([run](docs/IN_KIND_VAULT.md), `npm run fork:vault`). It counts proportions rather than fixed units, because xStocks pay dividends and fees through a balance multiplier. It is not deployed, and a cash path and rebalancing are not built.
5. Lending against USTX. `GanymedeLendingMarket` lends demo dollars against USTX valued at the recorded NAV, and liquidators who repay an unhealthy loan redeem the seized USTX at the fund. It is live on X Layer Testnet at [`0xae2f54ae3d0370295de18510d56de92afb8843c7`](https://web3.okx.com/explorer/x-layer-testnet/address/0xae2f54ae3d0370295de18510d56de92afb8843c7): the USTX page's Borrow section deposits USTX from OKX Wallet, borrows against it, repays and withdraws, or lends demo dollars, and a test wallet supplied the first $5,000. `npm run fork:lending` runs a full cycle, liquidation included, against the live testnet contracts in memory.
6. Liquidity for tokenized assets on Uniswap v4. `GanymedeRwaLiquidityHook` runs a USTX/dUSD pool around the NAV and holds its liquidity for the providers who deposit into it: a base range about 2% either side of the NAV, and at each NAV record it moves the empty pool to the new NAV before trading resumes, so providers do not sell to arbitrageurs at the old price. With the NAV recorded 5% higher, the constant-product pool loses $2.69 of $10,000 to arbitrage in the tests while the hooked pool loses less than a tenth of a cent. Deposits are priced at the first NAV record after them, like fund subscriptions, so a deposit made just before a trade takes none of it. The fee rises with the NAV's age and swaps stop when it is over an hour old. It is built and tested against the code of Uniswap's PoolManager on X Layer mainnet and is deployed and seeded on X Layer Testnet next to the live fund ([design and run](docs/UNISWAP_V4_LIQUIDITY.md); `npm run fork:v4` rehearses it on a fork). The Pools screen shows it with its panel (deposit, a deposit waiting for the next NAV record with cancel and convert-now, claim and withdraw), and the arbitrage keeper moves it to each NAV record.

## Reproduce locally

Use Node.js 22.13 or later and npm. From a clean checkout:

```sh
npm ci
npm test
npm run dev
```

`npm test` type-checks and builds the application, then runs the suite: demo orders and fund totals, the public NAV API, USTX market data, integer NAV verification, the tamper experiment, evidence files, wallet valuation, the NAV series, tampered documents, unavailable data, publication retries, paper-ledger integrity and server-rendered routes. It needs no production credentials and submits no transactions. The public UI renders locally, but live data needs a configured D1 database and provider settings.

For optional local database setup after building:

```sh
npx wrangler d1 execute site-creator-d1 --local --config dist/server/wrangler.json --file drizzle/0000_giant_speedball.sql
npx wrangler d1 execute site-creator-d1 --local --config dist/server/wrangler.json --file drizzle/0001_demo_ledger.sql
```

See [the engine reference](docs/ENGINE_REFERENCE.md) for setting names and deployment details. Never copy production secrets into a review checkout. Relayer checks: run `npm ci`, `npm run typecheck` and `npm test` in `relayer/`.

## Source and release

This public review snapshot corresponds to production source commit `b45516dcae1a9305e99a8a5f0f4470b42956a61e`. Application code matches the recorded source; documentation may be newer. The original development history remains private, and public-hosting identifiers are adjusted. See [snapshot provenance](docs/BUILD_EVIDENCE.md). Cloudflare deployment messages identify the production source commit. [Release rules and identity model](docs/release-identity.md).

- [Dev Day submission notes](docs/OKX_DEV_DAY.md) and [build-period work](docs/BUILD_PERIOD.md)
- [Asset credits](public/ASSET-CREDITS.md)
- Product screens: `app/product-ui/`
- Calculation: `lib/xstocks/basket.ts`
- Publication: `lib/xstocks/cycle.ts`
- Browser verification: `lib/xstocks/proof.ts`, `lib/xstocks/onchain.ts`
- Tamper experiment: `lib/xstocks/proof-experiment.ts`
- Evidence file and command: `lib/xstocks/evidence.ts`, `scripts/verify-evidence.mjs`
- X Layer mainnet reads and wallet valuation: `lib/xstocks/mainnet.ts`, `lib/xstocks/wallet.ts`
- Wallet investing: `contracts/GanymedeBasketFund.sol`, `contracts/GanymedeDemoDollar.sol`, `lib/xstocks/fund.ts`, `app/product-ui/WalletInvest.tsx`
- NAV price feed: `contracts/GanymedeNavFeed.sol`
- USTX market: `contracts/GanymedeUstxPool.sol`, `contracts/GanymedeNavArbitrage.sol`, `readPoolMarket` in `lib/xstocks/fund.ts`, the keeper in `relayer/src/keeper.ts`
- Lending market: `contracts/GanymedeLendingMarket.sol`, `lib/xstocks/lending.ts`, `app/product-ui/Lending.tsx`, `onchain/scripts/fork-lending.ts`, `onchain/scripts/deploy-lending.ts`, `onchain/scripts/activate-lending.ts`
- Demo investing and fund totals: `lib/demo/ledger.ts`, `app/api/demo/`, look-through: `lib/demo/basket.ts`
- Market activity: `lib/xstocks/activity.ts`, `lib/xstocks/activity-index.ts` (the scheduled job, `ACTIVITY_CRON` in `worker/index.ts`), `app/api/v1/ustx/activity/route.ts`, `app/product-ui/MarketActivity.tsx`
- Public NAV API and badge: `app/api/v1/ustx/route.ts`, `app/embed/ustx/`
- Second price source: `lib/xstocks/pool-prices.ts`, the publisher's check in `lib/xstocks/cycle.ts`, `app/product-ui/PoolCheck.tsx`
- Baskets from a configuration file: `lib/xstocks/basket-config.ts`, `scripts/basket-publish.mjs`, `public/baskets/mag3/`, `app/product-ui/BasketCheck.tsx`, `app/embed/basket/`
- In-kind vault: `contracts/GanymedeBasketVault.sol`, `onchain/scripts/fork-vault.ts`, `onchain/test/GanymedeBasketVault.test.ts`, `docs/IN_KIND_VAULT.md`
- Uniswap v4 liquidity: `contracts/GanymedeRwaLiquidityHook.sol`, `contracts/GanymedeV4Router.sol`, `onchain/scripts/_v4.ts`, `onchain/scripts/fork-v4.ts`, `onchain/scripts/deploy-v4.ts`, `onchain/test/GanymedeRwaLiquidityHook.test.ts`, `docs/UNISWAP_V4_LIQUIDITY.md`
- Pools: `app/pools/page.tsx`, `app/product-ui/Pools.tsx`, `app/product-ui/PoolsV4.tsx`, `app/product-ui/LiquidityParts.tsx`, `lib/xstocks/liquidity.ts`, `lib/xstocks/v4-liquidity.ts`, `tests/liquidity.test.mjs`, `tests/v4-liquidity.test.mjs`, `onchain/test/AppFundClient.test.ts`, `onchain/test/AppV4Client.test.ts`

AI-assisted development was used. The submitting team remains responsible for explaining, reviewing and maintaining the work. No customer adoption or independent audit is claimed.
