# Ganymede — inspectable NAV for tokenized-stock baskets

Ganymede helps basket operators publish the data behind a net asset value (NAV), and gives analysts a way to check that calculation against a public chain record. It demonstrates this with **GMD USTX**, a model basket of six US technology xStocks.

[Open the product](https://ganymede-xlayer.gana003.workers.dev/) · [Explore USTX](https://ganymede-xlayer.gana003.workers.dev/?app=select) · [Verify NAV](https://ganymede-xlayer.gana003.workers.dev/proof)

## Try the core flow

1. In Funds, inspect AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx, their fixing weights and the latest price snapshot.
2. Open Proof of NAV. Review the published composition, its holding values and the chain record.
3. Your browser reads the pinned X Layer Testnet registry directly, hashes the original document and recalculates every holding value.
4. After all three checks pass, increase one price by $1 in a local copy. The real verifier detects both hash and arithmetic mismatches. Restore the original and verify again.

No wallet, account or transaction is needed for this flow. A missing document or unavailable RPC stays unverified; pricing freshness is reported separately from record consistency.

## Meaningful OKX integration

| Component | Use |
| --- | --- |
| OKX OnchainOS Market API | Signed requests for token prices on X Layer mainnet (196) |
| X Layer mainnet | Network on which the six constituent token addresses are priced |
| X Layer Testnet (1952) | Stores NAV and the SHA-256 fingerprint of the canonical composition |
| Browser verifier | Reads the registry directly and verifies exact integer arithmetic and document bytes |
| Optional injected wallet | Test-network connection for the separate paper strategy lab; not needed to verify NAV |

NAV registry: [`0xf320d2a7f280b7ab61e24374986869d7be34289c`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c).

The older crypto strategy engine and paper portfolio remain available as a separate lab. They are not USTX holdings or evidence of a live fund. [Engine reference](docs/ENGINE_REFERENCE.md).

## What the checks mean

They establish agreement between a published document, its arithmetic and an on-chain record. They do **not** establish custody, backing, price accuracy, liquidity, investment safety or regulated fund status. Ganymede does not hold or custody the modeled xStocks. Contracts are unaudited. There is no public offering.

Pricing uses one provider. Publication is attempted on a five-minute schedule but can be delayed or fail. USTX never substitutes reference prices for missing eligible quotes. The code's quote-age default is 360 minutes and can be overridden; the provider timestamp is not a guarantee of the last trade time. This differs from the UI's 15-minute cycle-delay indicator. Do not interpret either as an execution-price guarantee.

[Calculation method](https://ganymede-xlayer.gana003.workers.dev/methodology) · [Limitations and data policy](https://ganymede-xlayer.gana003.workers.dev/limitations) · [Portfolio identity](docs/release-identity.md)

## Reproduce locally

Use Node.js 24 (the tested version) and npm. From a clean checkout:

```sh
npm ci
npm test
npm run dev
```

`npm test` builds the application and runs the test suite, including isolated SQLite portfolio isolation, integer NAV verification, tampered documents, unavailable data and server-rendered navigation. It needs no production credentials and submits no transactions. Public UI renders locally, but API-backed live data requires a configured D1 database and provider settings; an unconfigured local preview is not a full production replica.

For optional local database setup after building:

```sh
npx wrangler d1 execute site-creator-d1 --local --config dist/server/wrangler.json --file drizzle/0000_giant_speedball.sql
```

See `.env.example` for setting names and [the engine reference](docs/ENGINE_REFERENCE.md) for deployment details. Never copy production secrets into a review checkout. Tests do not require enabling live trading or a signing key.

## Source and release

This public review snapshot corresponds to production source commit `28e0ce2ddfabaa87ebdc73007a37d84460bdfa46`. The original development history remains private. Public-hosting identifiers and review documentation are adjusted; application code, tests and dependency lockfile match the recorded source. See [snapshot provenance](docs/BUILD_EVIDENCE.md). Cloudflare deployment messages identify the production source commit. [Release rules and identity model](docs/release-identity.md).

- [Dev Day submission notes and build-period evidence](docs/OKX_DEV_DAY.md)
- [Asset credits](public/ASSET-CREDITS.md)
- Calculation: `lib/xstocks/basket.ts`
- Publication: `lib/xstocks/cycle.ts`
- Direct browser verification: `lib/xstocks/proof.ts`, `lib/xstocks/onchain.ts`
- Local failure experiment: `lib/xstocks/proof-experiment.ts`

AI-assisted development was used. The submitting team remains responsible for explaining, reviewing and maintaining the work. No customer adoption or independent audit is claimed.


### Latest review improvements

Overview now includes live browser verification and a local price-edit experiment.
Verify NAV places results first and exposes the configured quote eligibility
window separately from publication freshness. Two offline example reports reuse
the arithmetic verifier without claiming on-chain authentication. See
[report schema](docs/REPORT_SCHEMA.md) and [publication retry review](docs/PUBLICATION_RETRY_REVIEW.md).

Relayer checks: run `npm ci`, `npm run typecheck`, and `npm test` in `relayer/`.
