# Ganymede settlement relayer

Signs and submits the engine's settlement intents to X Layer testnet (or GIWA
Sepolia, via `SETTLEMENT_CHAIN`). **This is the only
component in the system that holds an EVM private key** — the application never
accepts one, which is why the relayer is deployed separately.

## API

Exactly the contract `lib/engine/settlement.ts` already expects:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/settlements` | Submit a settlement. Bearer auth + `Idempotency-Key`. |
| `GET /v1/eligibility/{address}` | Wallet eligibility check. `/v1/dojang/verified-address/{address}` is an alias. |
| `GET /v1/health` | RPC reachability, configured contracts, signer presence. Unauthenticated. |

## How a settlement becomes a transaction

```
engine → POST /v1/settlements → Worker (auth, validate, replay check)
                              → Submitter Durable Object (nonce queue, sign, send)
                              → X Layer testnet (SETTLEMENT_CHAIN)
```

Three properties matter:

**Nonce serialisation.** One engine cycle emits several settlements — a NAV
publication per product, plus rebalance evidence and fund flows. Signing those
concurrently hands the same nonce to several transactions and all but one fail.
Every submission funnels through a single Durable Object instance, so nonces are
issued in order. A drifted nonce triggers a resync rather than poisoning the queue.

**Idempotency, three deep.** Keyed on `entityType:entityId:action` — the same
string the engine already sends as its `Idempotency-Key`.

1. The relayer's D1 ledger returns the first result for a repeat request.
2. `simulateContract` runs before spending gas, so a doomed call never becomes a
   transaction.
3. The contracts' own `processedSettlement` / `publishedPayload` guards are the
   final backstop.

The settlement id is derived from `entityType:entityId:action` and deliberately
**not** from the request payload hash — the payload carries `effectiveAt`, which
changes between retries, so keying on it would mint the same subscription twice.
`relayer/src/ids.ts` is the single source of that derivation, and the contract
tests in `onchain/test` import the same module.

**Reverts that mean "already done".** `SettlementAlreadyProcessed` and
`DuplicatePayload` are recorded as `confirmed`, not failures. Returning an error
would make the engine retry forever against a guard that will never let it
through.

`StalePublication` only says the registry already holds an equal or newer
snapshot. Because the registry checks staleness before duplicates, an exact
retry of a published NAV also lands here, so the submitter reads
`publishedPayload(keccak256(abi.encode(...)))` for the exact payload: present
means `confirmed`, absent means `409 stale_publication`.

The share ledger checks its allowlist and pause before its replay guard, so a
retried mint or burn that already landed can revert with another error. On any
share-ledger revert the submitter reads `processedSettlement(settlementId)` and
confirms the request if the ledger has already processed it.

Other reverts map to actionable responses: `TransferRestricted` →
`409 investor_not_allowlisted`, `ContractPaused` → `503`, `Unauthorized` →
`500 role_misconfigured` (the relayer key lost its issuer/publisher role).

## Setup

```bash
cd relayer
npm install
npm run typecheck
npm test                   # request mapping, revert handling, ids and submission lifecycle; no network

# wrangler.jsonc already names the deployed `ganymede-settlement-relayer`
# database. On a fresh Cloudflare account, create one and put its id there:
npm run db:create          # note the returned database_id
npm run db:migrate

npx wrangler secret put RELAYER_API_TOKEN         # shared with the app
npx wrangler secret put RELAYER_PRIVATE_KEY       # hot key, issuer + publisher
npx wrangler secret put FUND_SHARE_ADDRESS        # from onchain deploy
npx wrangler secret put NAV_REGISTRY_ADDRESS
# FUND_SHARE_PRODUCT_ID (optional, default core-20) names the one product that
# ledger holds; mint/burn requests for any other product get 409 product_not_tokenized.

npm run deploy
curl https://<worker>.workers.dev/v1/health
```

Then point the application at it:

```
SETTLEMENT_CHAIN=xlayer-testnet
SETTLEMENT_RELAYER_URL=https://<worker>.workers.dev
SETTLEMENT_RELAYER_TOKEN=<RELAYER_API_TOKEN>
FUND_SHARE_ADDRESS=0x...
NAV_REGISTRY_ADDRESS=0x...
```

No application code changes are needed — `lib/engine/settlement.ts` already branches on
these being present. With them unset every settlement stays `simulated`.

Trigger a cycle and the contracts start receiving real traffic:

```bash
curl -X POST -H "Authorization: Bearer $OPERATOR_TOKEN" \
     -H "Content-Type: application/json" -d '{"force":true}' \
     https://<app>/api/operations/run
```

## Eligibility

`/v1/eligibility/{address}` answers "can this wallet receive fund shares?"

- **X Layer:** reads `isAllowed(address)` on the share ledger — the exact check a
  mint enforces — and reports `"source": "onchain-allowlist"`.
- **GIWA Sepolia:** carries no real Upbit Korea Verified Address attestation, so
  it checks `DOJANG_TESTNET_ALLOWLIST` and always reports
  `"source": "testnet-stub"` so a caller cannot mistake it for a real
  attestation. Mainnet replaces it with a read against the Dojang scroll
  (`0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9`).

Each chain gets its own submitter Durable Object (`submitter-<chainId>`), since a
nonce belongs to a signer on one chain.

## Responses the app relies on

- Malformed amounts, hashes or times are `400 invalid_request`; the app treats
  every 4xx except 408/429 as final.
- `502 submission_failed` and other 5xx are retryable: the send may have reached
  the chain, so the app asks again with the same `Idempotency-Key`.
- The submitter waits up to 12 s for a receipt, well inside the app's 45 s
  budget; an unconfirmed hash is returned as `submitted` and reconciled on the
  next ask.
- Error bodies never include the RPC URL (it can carry a provider key); details
  go to the Worker log. `/v1/health` reports `ready: false` if the RPC answers
  for a different chain id.

## Operational notes

- Keep the relayer key funded with gas (OKB on X Layer, ETH on GIWA) — an unfunded signer fails
  every submission.
- Rotating the hot key needs no redeploy: `setIssuer` / `setPublisher` from the
  admin key, then update the Worker secret.
- The relayer cannot allowlist an investor. That is the transfer agent's job,
  held by the cold key (`cd onchain && WALLETS=0x... npm run allowlist`).
- Contract limits that code here cannot change (the contracts are deployed and
  source-verified):
  - Handing administration to a new key leaves the old key as transfer agent and
    allowlisted. Rotate with `setTransferAgent(new)` and
    `setInvestorPermission(old, false)` as well.
  - `publishRebalance` does not enforce ordering, so a late, older rebalance
    would overwrite `latestRebalanceHash`. The app publishes in order; readers
    that need history should use the `RebalancePublished` events.
