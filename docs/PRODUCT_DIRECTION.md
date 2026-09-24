# Product direction: an operating index product

> Superseded for design and implementation planning by [the detailed Korean product redesign plan](PRODUCT_REDESIGN_PLAN_KO.md), dated 2026-09-24. The user explicitly authorized replacing the existing design. The notes below retain the earlier product-gap and deployment record; they do not constrain the new visual design.

> Latest delivered scope and release: [PRODUCT_RELEASE.md](PRODUCT_RELEASE.md). Real money movement is explicitly excluded by the user; the current product reads the existing testnet ledger and NAV records.

## Decision
The primary experience must serve a user's investment lifecycle, not a hackathon judge's verification exercise. Retain transparent records as supporting evidence. Move price-tampering exercises and synthetic reports out of the default customer journey.

## Current evidence and gap
- Live pricing, basket valuation, NAV publication and direct browser verification work.
- app/api/portfolio accepts amountKrw and records a subscription request. A request is not proof that funds arrived.
- GanymedeFundShare is an issuer-controlled, restricted share ledger. Its mint/burn functions do not by themselves prove basket custody or redeem underlying assets.
- The existing paper workspace is a simulation, separate from USTX. It must not be relabeled as real holdings.

## First deliverable: one complete product lifecycle
Choose one supported basket and one settlement asset. Establish the custody/execution model and actual asset availability before promising purchase or redemption. Reuse existing pricing and proof components where appropriate; do not assume the current KRW simulation and share ledger already implement that model.

1. Product page: eligible assets, composition, NAV, actual fees, execution method and redemption conditions. Live status and short supporting evidence link. Primary action only enabled when the backend can fulfill it.
2. Entry: authenticated wallet/account, supported network, available balance, executable quote, approval if needed, user confirmation. No credit based solely on a typed amount or wallet address.
3. Settlement: confirmed funding -> actual asset execution -> reconciled holdings/share issuance. Expose pending, partial, failed and recoverable states. Retry cannot issue duplicate holdings.
4. Portfolio: actual balances, cost basis where available, valuation timestamp, transaction history and pending requests. Explain unavailable valuation; never substitute paper positions.
5. Exit: quote/conditions -> confirmed redemption -> asset delivery/payment -> reconciled balance and history. Share burning alone is not proof of payout.

## Product interface
- Public landing: product value, supported basket, how investing and exiting work.
- Application: Markets, My portfolio, Activity; evidence under the product's transparency details.
- Verification runs automatically; show a concise status and an optional evidence panel.
- Local tampering exercises and offline synthetic examples belong to a separate developer/demo page.
- Testnet remains clearly labeled until real assets, settlement and operational readiness have been verified. Remove repetitive engineering explanations from main screens, not factual environment disclosures.

## Responsibility and acceptance
Frontend/design work stays separate from Claude's lib/engine, lib/xstocks, relayer and app/api review. Agree request/response states before implementing purchase screens.

First acceptance is one user's end-to-end lifecycle on a test deployment using the intended transaction path: fund, execute, receive a position, refresh/reopen, redeem, receive assets, reconcile. Also exercise rejection, failed execution, duplicate retries and interrupted sessions. This is a production-path test, not a second paper simulator. Actual-money launch additionally requires resolved custody, asset eligibility, operational controls and independent review appropriate to the product.

No live trading, real-money acceptance, contract redeployment or investment functionality is authorized or performed by the current presentation-only release.

Presentation release c5a5565 was deployed with variables preserved as Worker version 2a336068-daa8-4530-bb07-1c3d51029477. Root typecheck/build and 57 tests passed. This releases sculpture motion and record-panel layout only; the product lifecycle above remains the next development scope.
