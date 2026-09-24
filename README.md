# Ganymede — inspectable NAV for tokenized-stock baskets

Ganymede presents a tokenized-stock basket as a product whose value can be checked. It demonstrates this with **GMD USTX**, a model basket of six US technology xStocks. Visitors can browse the basket, follow its published NAV history and composition, and have their browser verify the latest record against X Layer. Nothing can be bought or redeemed yet.

[Markets](https://ganymede-xlayer.gana003.workers.dev/) · [USTX](https://ganymede-xlayer.gana003.workers.dev/products/ustx) · [Transparency](https://ganymede-xlayer.gana003.workers.dev/products/ustx/transparency) · [Portfolio](https://ganymede-xlayer.gana003.workers.dev/portfolio) · [Activity](https://ganymede-xlayer.gana003.workers.dev/activity) · [Lab](https://ganymede-xlayer.gana003.workers.dev/lab)

## Try the product

1. **Markets** shows USTX, its latest published NAV, the publication history available and the actual value weights of AAPLx, MSFTx, NVDAx, AMZNx, METAx and TSLAx.
2. **USTX** charts the NAV at its real publication times, lets you pick a holding to see its contribution per share, and states the product's terms and that investing is not open.
3. **Transparency** runs the checks automatically. Your browser reads the pinned X Layer Testnet registry directly, hashes the original composition document and recalculates the NAV. Technical detail, quote-age policy, publication history and the original document are expandable.
4. **Portfolio** reads the GMDCORE test share ledger for a public address, either one your wallet shares or one you type. **Activity** lists that address's CORE transfers in the last 2,000 blocks and opens each transaction's receipt. These are read-only views of a testnet ledger, not USTX holdings.
5. **Lab** keeps the separate experiments: the price-edit experiment, where a $1 change in a local copy makes the real verifier fail and restoring it passes again, and the older KRW paper strategies.

No account, signature or transaction is needed. The wallet is asked only for a public address. A missing document or unavailable RPC stays unverified, and pricing freshness is reported separately from record consistency.

## Meaningful OKX integration

| Component | Use |
| --- | --- |
| OKX OnchainOS Market API | Signed requests for token prices on X Layer mainnet (196) |
| X Layer mainnet | Network on which the six constituent token addresses are priced |
| X Layer Testnet (1952) | Stores NAV and the SHA-256 fingerprint of the canonical composition; hosts the GMDCORE test share ledger |
| Browser verifier | Reads the registry directly and verifies exact integer arithmetic and document bytes |
| Browser ledger reader | Reads GMDCORE balances, transfer logs and receipts over public RPC after checking the chain ID, contract code and decimals |
| Optional injected wallet | Shares a public address for Portfolio and Activity; never asked to sign or send |

NAV registry: [`0xf320d2a7f280b7ab61e24374986869d7be34289c`](https://web3.okx.com/explorer/x-layer-testnet/address/0xf320d2a7f280b7ab61e24374986869d7be34289c). GMDCORE share ledger: [`0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59`](https://web3.okx.com/explorer/x-layer-testnet/address/0x68c4e8c904b3eddb1146ef52a76a0a2755a55b59).

The share ledger is an issuer-controlled, allowlisted testnet record. Its mint and burn are not evidence of a deposit or payout, and GMDCORE is not a claim on USTX. The older crypto strategy engine and paper portfolio are in Lab. They are not USTX holdings or evidence of a live fund. [Engine reference](docs/ENGINE_REFERENCE.md).

## What the checks mean

They establish agreement between a published document, its arithmetic and an on-chain record. They do **not** establish custody, backing, price accuracy, liquidity, investment safety or regulated fund status. Ganymede does not hold or custody the modeled xStocks. There is no deposit address, settlement token or custody contract, and investing and redemption are not implemented. Contracts are unaudited. There is no public offering.

Pricing uses one provider. Publication is attempted on a five-minute schedule but can be delayed or fail. USTX never substitutes reference prices for missing eligible quotes. The code's quote-age default is 360 minutes and can be overridden; the provider timestamp is not a guarantee of the last trade time. This differs from the UI's 15-minute cycle-delay indicator. Do not interpret either as an execution-price guarantee.

[Calculation method](https://ganymede-xlayer.gana003.workers.dev/methodology) · [Limitations and data policy](https://ganymede-xlayer.gana003.workers.dev/limitations) · [Portfolio identity](docs/release-identity.md)

## Reproduce locally

Use Node.js 22.13 or later and npm. From a clean checkout:

```sh
npm ci
npm test
npm run dev
```

`npm test` type-checks and builds the application, then runs the suite: USTX market data and ledger adapters, integer NAV verification, tampered documents, unavailable data, publication retries, paper-ledger integrity, portfolio isolation and server-rendered routes. It needs no production credentials and submits no transactions. Public UI renders locally, but API-backed live data requires a configured D1 database and provider settings; an unconfigured local preview is not a full production replica.

For optional local database setup after building:

```sh
npx wrangler d1 execute site-creator-d1 --local --config dist/server/wrangler.json --file drizzle/0000_giant_speedball.sql
```

See `.env.example` for setting names and [the engine reference](docs/ENGINE_REFERENCE.md) for deployment details. Never copy production secrets into a review checkout. Tests do not require enabling live trading or a signing key. Relayer checks: run `npm ci`, `npm run typecheck` and `npm test` in `relayer/`.

## Source and release

This public review snapshot corresponds to production source commit `f0ae49ce3f410af6cfcab9d3e2ff4e3a85aa4d68`. Application code matches the recorded source; documentation may be newer. The original development history remains private, and public-hosting identifiers are adjusted. See [snapshot provenance](docs/BUILD_EVIDENCE.md) and [the product release notes](docs/PRODUCT_RELEASE.md). Cloudflare deployment messages identify the production source commit. [Release rules and identity model](docs/release-identity.md).

- [Dev Day submission notes and build-period evidence](docs/OKX_DEV_DAY.md)
- [Asset credits](public/ASSET-CREDITS.md)
- Product screens: `app/product-ui/`
- Market data and publication history: `lib/product-market.ts`
- Test share ledger reader: `lib/product-ledger.ts`
- Calculation: `lib/xstocks/basket.ts`
- Publication: `lib/xstocks/cycle.ts`
- Direct browser verification: `lib/xstocks/proof.ts`, `lib/xstocks/onchain.ts`
- Local failure experiment: `lib/xstocks/proof-experiment.ts`

AI-assisted development was used. The submitting team remains responsible for explaining, reviewing and maintaining the work. No customer adoption or independent audit is claimed.
