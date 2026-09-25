# Ganymede — a tokenized-stock fund you can verify yourself

Ganymede sells **USTX, the US Tech Basket**: one share holds Apple, Microsoft, NVIDIA, Amazon, Meta and Tesla through their xStocks on X Layer. You invest with demo dollars, see exactly which tokens your money put in the basket, and check every price yourself. Every five minutes Ganymede prices the xStocks through OKX OnchainOS, records the NAV, the shares outstanding and a SHA-256 fingerprint of the full composition on X Layer, and your browser reads that record directly and recalculates the NAV. The result can be downloaded as an evidence file and re-checked anywhere with one command.

[Markets](https://ganymede-xlayer.gana003.workers.dev/) · [USTX](https://ganymede-xlayer.gana003.workers.dev/products/ustx) · [Verify](https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency) · [Portfolio](https://ganymede-xlayer.gana003.workers.dev/portfolio) · [For issuers](https://ganymede-xlayer.gana003.workers.dev/issuers) · [Developers & API](https://ganymede-xlayer.gana003.workers.dev/developers) · [Methodology](https://ganymede-xlayer.gana003.workers.dev/methodology) · [Limitations](https://ganymede-xlayer.gana003.workers.dev/limitations)

Investing uses demo dollars on X Layer Testnet records: no real money moves and no shares are issued on chain.

**Built for OKX Dev Day 2026 (Build a Market).** Ganymede existed before the event. The new work of the 17–25 September build period is listed with its commits in [docs/BUILD_PERIOD.md](docs/BUILD_PERIOD.md) and summarized below.

## Try it in two minutes

1. **Markets** shows USTX with its latest NAV, fund size, investors, return since launch, the NAV history and the weights of AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx. A status chip reports the check your browser has just run against X Layer.
2. **Invest** on the USTX page. Every browser gets a private demo account with $10,000 in demo dollars. Choose an amount, review, and the order fills instantly at the NAV recorded on X Layer. The confirmation shows what went into your basket: the amount of each xStock your shares now hold and its value.
3. **The fund overview** on the same page shows the fund size (shares outstanding × NAV, both recorded on X Layer), investors, return since the $100.00 launch on 23 September 2026, the key terms, 24-hour flows and what all shares hold of each xStock.
4. **Portfolio** shows your demo account: total value, return, your USTX looked through to each xStock, and your orders. Below it, connect a wallet (OKX Wallet first) or paste any public address to value real xStock balances on X Layer mainnet at the verified prices, with a downloadable statement and a USTX-weighted basket calculator. The wallet part is read-only; nothing is signed or sent.
5. **Verify** is the customer proof page, in the manner of an exchange's proof of reserves. It shows the result of the check your browser runs automatically, how every price is made (priced by OKX OnchainOS, recorded on X Layer, checked in your browser), the holdings, the latest record, recent records with OKX Explorer links and what verification covers.
6. **Developers → Verify it yourself** shows the checks behind it. Your browser reads the pinned registry on X Layer Testnet, hashes the original document and recalculates every holding. Each check is shown with its result.
7. **Try to break it** on the developer page edits a copy of the document in your browser in three ways:
   - change one price: the row arithmetic and the fingerprint fail;
   - also fix the arithmetic: the NAV no longer matches the record;
   - offset two prices so every number and the NAV stay the same: only the fingerprint recorded on X Layer catches the change.
8. **Download evidence** on the developer page saves the document, the record and the publishing transaction. Anyone can re-check it:

```sh
npm ci
npm run verify:evidence -- ustx-evidence.json
```

The command repeats the fingerprint and arithmetic checks against the verifier's pinned deployment. It then reads the transaction receipt from X Layer and requires a matching `NavPublished` event, so a file still verifies after its record is no longer the latest. Add `--offline` to skip the chain read.

No sign-up, signature or transaction is needed.

## For partners

- **Public NAV API.** `GET /api/v1/ustx` returns the latest record read from X Layer at request time: NAV, shares outstanding, fingerprint, transaction and verification links. No key, CORS open to every origin.
- **Embeddable badge.** `/embed/ustx` is an iframe any site or wallet can show. It verifies the NAV in the visitor's own browser before it says "Verified".
- **Issuers.** [/issuers](https://ganymede-xlayer.gana003.workers.dev/issuers) explains how another tokenized-stock basket can launch on the same rails, with planned pricing and a roadmap. [/developers](https://ganymede-xlayer.gana003.workers.dev/developers) has the API, a viem example that reads the registry directly and the embed code.

## What was built during the event

| Area | New in the build period |
| --- | --- |
| X Layer | Settlement moved from the GIWA Sepolia testnet to X Layer Testnet. NAV registry, share ledger and relayer deployed; sources verified on the explorer |
| Tokenized stocks | Six-xStock basket priced through OKX OnchainOS on X Layer mainnet. Publication gates reject missing, stale or mismatched quotes. NAV and fingerprint published every five minutes |
| Verification | Direct browser read and recalculation, a mainnet check of the six xStock contracts, the three-way tamper experiment, the evidence file and `verify:evidence` |
| Investing | Demo accounts with $10,000 in demo dollars, instant orders at the recorded NAV, idempotent retries and a daily order cap; a confirmation that shows the tokens each order put in the basket; a portfolio that looks through to every xStock |
| Fund | Fund overview with size, investors, return since launch and look-through holdings; the demo shares outstanding recorded on X Layer with every NAV |
| Portfolio | Read-only valuation of any wallet's xStocks on X Layer mainnet at the verified prices, a downloadable statement and a USTX-weighted basket calculator |
| Ecosystem | Public NAV API with open CORS, an embeddable self-verifying badge, issuer and developer pages |
| Product | Markets, USTX, Portfolio and Verify screens built around the browser check |
| Hardening | Public reads never write, spoofable identity headers ignored, relayer retries reconcile before re-sending, upstream errors kept out of public responses |

Commit-by-commit detail, with times and line counts: [docs/BUILD_PERIOD.md](docs/BUILD_PERIOD.md).

## Project history

Ganymede started in July 2026 as a Korean-won crypto strategy engine. Its paper portfolios are priced from Upbit market data, and its fund-share settlement was first built for the GIWA Sepolia testnet with a Dojang verified-address check. That code is still in the repository. It powers the separate paper Lab, which is not part of the submission's new work.

For OKX Dev Day we moved settlement to X Layer and built the tokenized-stock product on top. The GMDCORE share-ledger contract deployed to X Layer comes from that earlier rail, so its verified source still describes GIWA settlement. The same X Layer registry also carries NAV records for the earlier paper strategies under a different product key. The USTX check reads only the USTX key.

## OKX integration

| Component | Use |
| --- | --- |
| OKX OnchainOS Market API | Signed price requests for the six xStock tokens on X Layer mainnet (196). The prices are the inputs of every NAV |
| X Layer mainnet | Where the priced xStock tokens live. The browser reads the six pinned token contracts (code, symbol, decimals) and any wallet's balances directly |
| X Layer Testnet (1952) | `GanymedeNavRegistry` stores each NAV, the shares outstanding, the effective time and the composition fingerprint and emits `NavPublished` |
| OKX Wallet | Portfolio connects `window.okxwallet` first to read an address; it never asks for a signature |
| OKX explorer | Every record, token and transaction links to the OKX X Layer explorer |
| Public API and badge | `/api/v1/ustx` and `/embed/ustx` let other X Layer apps show the verified NAV |
| Browser verifier | Reads the registry over public RPC after checking the chain ID, then verifies exact document bytes and integer arithmetic |
| Evidence command | Re-checks a downloaded file and matches it to the `NavPublished` event in its transaction receipt |

NAV registry: [`0xf320d2a7f280b7ab61e24374986869d7be34289c`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c) on X Layer Testnet.

## What a match means

A match shows that one published document, its arithmetic and its X Layer record agree, and that the document was not changed after publication. It does **not** show that the prices are accurate (there is one provider), that anyone holds the tokens, or that the NAV can be traded or redeemed.

- **USTX** is a model basket. Investing uses demo dollars in a demo ledger: it issues no shares on chain, holds no assets and gives no rights.
- **xStocks** carry the rights their issuer's documents describe. Ganymede does not hold them.
- **GMDCORE** is an issuer-controlled test share ledger from the earlier settlement work. Its supply is zero, and it is not a claim on USTX.
- **Portfolio valuations** price the six xStocks at the recorded prices. A valuation is not an executable quote and does not prove who controls an address.

Ganymede has no deposit address, settlement token or custody contract. Contracts are unaudited, and there is no public offering. [Limitations and data policy](https://ganymede-xlayer.gana003.workers.dev/limitations).

## Prior work and what is different

Putting NAV data on chain is not new. The [DTCC Smart NAV pilot](https://www.dtcc.com/insights/2024/smart-nav-pilot-report-bringing-trusted-data-to-the-blockchain-ecosystem) distributed fund NAVs to several chains. [Centrifuge](https://docs.centrifuge.io/user/manager/nav/) managers publish share prices on chain. [Reserve Index DTFs](https://docs.reserve.org/core-components/index-dtfs/overview) already issue and redeem token baskets. [Chainlink Proof of Reserve](https://chain.link/proof-of-reserve) addresses asset backing, a different problem that Ganymede does not solve.

Ganymede's contribution is narrower. Any visitor can reproduce a published basket NAV row by row in their own browser against an X Layer record, see which check catches which kind of change, and hand the result to someone else as a file they can verify independently.

## Business model and next steps (not built)

Ganymede is built to become the verification and distribution layer for tokenized-stock baskets on X Layer. [/issuers](https://ganymede-xlayer.gana003.workers.dev/issuers) lists the planned pricing: a free sandbox (today's testnet product), a per-basket subscription for issuers publishing on X Layer mainnet, and a distribution fee on assets raised through licensed partners.

1. Publish the registry on X Layer mainnet and keep every document in a public archive, so any past record can be verified in the interface.
2. Add a second price source and a written policy for corporate actions and constituent changes.
3. An issuer console so other basket operators can launch their own baskets on the same registry format.
4. With an issuer, custody and legal structure in place, a vault holding the xStocks, a basket token that mints and redeems at the verified NAV, and rebalancing through OKX DEX. None of this has started.

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

See `.env.example` for setting names and [the engine reference](docs/ENGINE_REFERENCE.md) for deployment details. Never copy production secrets into a review checkout. Relayer checks: run `npm ci`, `npm run typecheck` and `npm test` in `relayer/`.

## Source and release

This public review snapshot corresponds to production source commit `f660dc3f528783f1afc167561b653ad6864bd9df`. Application code matches the recorded source; documentation may be newer. The original development history remains private, and public-hosting identifiers are adjusted. See [snapshot provenance](docs/BUILD_EVIDENCE.md). Cloudflare deployment messages identify the production source commit. The current release, its checks and its limits are in [the product release notes](docs/PRODUCT_RELEASE.md). [Release rules and identity model](docs/release-identity.md).

- [Dev Day submission notes](docs/OKX_DEV_DAY.md) and [build-period work](docs/BUILD_PERIOD.md)
- [Asset credits](public/ASSET-CREDITS.md)
- Product screens: `app/product-ui/`
- Calculation: `lib/xstocks/basket.ts`
- Publication: `lib/xstocks/cycle.ts`
- Browser verification: `lib/xstocks/proof.ts`, `lib/xstocks/onchain.ts`
- Tamper experiment: `lib/xstocks/proof-experiment.ts`
- Evidence file and command: `lib/xstocks/evidence.ts`, `scripts/verify-evidence.mjs`
- X Layer mainnet reads and wallet valuation: `lib/xstocks/mainnet.ts`, `lib/xstocks/wallet.ts`
- Demo investing and fund totals: `lib/demo/ledger.ts`, `app/api/demo/`, look-through: `lib/demo/basket.ts`
- Public NAV API and badge: `app/api/v1/ustx/route.ts`, `app/embed/ustx/`

AI-assisted development was used. The submitting team remains responsible for explaining, reviewing and maintaining the work. No customer adoption or independent audit is claimed.
