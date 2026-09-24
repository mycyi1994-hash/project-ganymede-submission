# Product stages 1–3: decisions and integration contract

> 2026-09-24 범위 확정: 사용자가 실제 입출금·보관 계약 및 결제 토큰이 없음을 확인했다. 이번 후속 배포는 기존 테스트넷 장부 조회·NAV·모의 운용 범위로 완성한다. 아래 실제 투자·회수 계획은 후속 제품 과제이며 이번 완료 범위가 아니다. 최신 구현·검수·배포 기록은 [PRODUCT_RELEASE.md](PRODUCT_RELEASE.md)를 따른다.
2026-09-24 · implementation branch `codex/product-redesign-1-3`

## Decisions made in this delivery

- Customer product: one US technology basket, USTX. Six constituents are already defined by the pricing model; the crypto paper strategies are separate Lab content.
- Journey: Markets → product and terms → investment review → transaction → Portfolio. Transparency is supporting detail. A customer never has to complete a verification exercise to navigate the product.
- Target funding unit for design/integration: USDC. This is a proposed settlement asset, **not** confirmation of an approved token address, available route or deployed custody contract. The current product capability deliberately has `settlementAsset: null`.
- Target economic model: shares backed by an identifiable pool of acquired basket assets. Subscription completion requires both funding and reconciled asset acquisition/share credit. Redemption completion requires actual payment or delivery, not just a burn. Whether that pool is implemented as a segregated vault or another custody arrangement requires backend feasibility and operating decisions before transaction integration.
- Current runtime capability: read-only, testnet NAV evidence; `canSubscribe = false`, `canRedeem = false`. No balance is inferred from a connected wallet, cookie paper portfolio or typed amount.
- Account connection in the new shell only requests wallet accounts. It neither signs an authentication challenge nor silently switches the network. A backend account/session remains a separate requirement.

## Confirmed from source

| Existing capability | Boundary |
| --- | --- |
| `/api/xstocks`: composition, latest evaluation, publication history, chain snapshot | Pricing and NAV evidence; no executable subscription quote |
| Pinned direct-chain read + `verifyComposition` | Calculation/document/record consistency; not custody |
| `/api/portfolio`: request and portfolio ledger | Current KRW/paper workflow is not a USDC-funded USTX investment |
| Issuer-controlled share mint/burn | Requires reconciled asset funding and payout before being used as customer settlement proof |
| Pricing chain 196; NAV registry on testnet 1952 | They must not be presented as one already-working mainnet investment route |

## Backend decisions required before stage 4

1. Confirm acquisition and exit liquidity for all six eligible assets and the exact settlement token/decimals on the execution network. A pricing API response is insufficient.
2. Select and document the custody/pool implementation, share rights, inventory reconciliation and who can operate it. No pool address exists in the new frontend contract yet.
3. Supply authenticated account state and quotes bound to an account, network, amount, destination, fee and expiry. Wallet address alone is not identity proof.
4. Provide an idempotent transaction identifier and durable progress events; distinguish received funds, executed assets, share settlement and actual payout.
5. Specify partial execution, interruption, failed purchase, return-of-funds and delayed-redemption paths. Define which evidence faults pause trading.
6. Publish actual fees, minimums, eligibility and redemption conditions. Example design figures are not product terms.

These are explicitly unresolved integration decisions, not completed backend work. Stages 2–3 proceed using current public data and an isolated local design preview.

## Frontend contract

`lib/product-contract.ts` contains the capability, quote and transaction types. It does not send transactions or pretend to implement the backend endpoints.

Quote fields: quote/account/product IDs; chain ID; side; input/output assets and integer units; minimum received; fee and denomination; expiry; destination. Changing the account, chain, amount or quote must invalidate the previous review.

| State | Customer meaning | Completion/next action |
| --- | --- | --- |
| review | Terms visible; nothing sent | Review valid quote |
| wallet | Awaiting wallet action | Approval/signature, with cancellation supported |
| submitted | An identified request exists | Query this request, never issue another automatically |
| funding | Waiting for or confirming funds | Credit only confirmed funding |
| execution | Acquiring or disposing of actual assets | Reconcile execution results |
| settled | Shares/position reconciled | Subscription may complete; redemption may still require payout |
| payout | Return/delivery pending | Keep tracking actual transfer |
| completed | Required settlement and delivery confirmed | Show actual output and history |
| rejected | No accepted action or explicit rejection | Preserve useful inputs; explain whether any funds moved |
| recovery | Partial/failed execution after acceptance | Show funds/assets affected and permitted recovery action |

`canRetry` and `requiresAction` are server-authored capabilities. The UI must not infer them from elapsed time. Read states distinguish loading, empty, stale and unavailable; none default to a zero balance.

## Delivered screen structure

- `/`: new Markets using actual public NAV history and the composition matching that record.
- `/products/ustx`: value/history, composition, terms and truthful investment-access state.
- `/products/ustx/transparency`: automatic direct-chain verification, record/composition, expandable exact evidence.
- `/portfolio`, `/activity`: truthful pre-access states; no example account data.
- `/design-preview`: development-only connected Markets, product/order, example Portfolio, Activity and processing/completed/recovery screens. Every screen is marked as example account data. There are no transaction API calls or wallet signatures.
- `/lab` and `/lab/verification`: preserved paper workspace and technical experiments.

## Review and handoff

New UI/data adapters are outside Claude's reserved `lib/engine`, `lib/xstocks`, `relayer`, and `app/api` paths. The latest Claude branch was fast-forward integrated through `1e0a6bf` before new work. Its retry/nonce/publication/identity corrections remain intact.

Local read-only preview: run the application on port 3127, then `node scripts/product-preview.mjs` for port 3128. Only public market/xStocks GETs are forwarded; the Lab account is a marked empty local fixture and all mutation requests are rejected. `--fail-market` with another `PRODUCT_PREVIEW_PORT` serves an unavailable-data review. Never deploy the preview proxy.

No live investment, custody contract, executable quote, redemption or production rollout is completed by stages 1–3. Product-path feasibility is the remaining stage-1 dependency for stage 4; the interaction contract and all requested design/read-only frontend work can be reviewed now.
