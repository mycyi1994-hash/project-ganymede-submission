# Refinement release verification — 2026-09-24

Application source: 41de09df73150a0177d8a209abdd1926d0fc9977.
Application version: 91eba3cc-00d7-4d2a-8050-4c9daa01e827.
Relayer version: a9cf2c42-f4d8-48f2-8a3c-d167a03437f5.

## Delivered
- Separate pricing-cycle, configured quote eligibility and publication states.
- Basket / Verify NAV / Paper lab navigation; optional wallet is secondary.
- Live direct-RPC verification and a local price-edit experiment on Overview.
- Results-first Proof page and two explicitly synthetic example reports sharing
  the arithmetic verifier, while live USTX remains pinned to its deployment.
- Exact historical payload checks for stale publication, serialized submissions,
  immediate transaction-hash persistence and receipt reconciliation on retry.

## Verification evidence
- Application build and 51 tests pass; public export build and 51 tests pass.
- Relayer typecheck and 5 transport/storage-mocked lifecycle tests pass.
- Relayer compatible dependency audit update reports zero known findings.
- Ten public page routes plus /api/xstocks returned 200 after deployment.
- Live Proof: 3/3 passed; $1 local edit produced hash/arithmetic mismatches;
  restore via Enter passed both. No test transaction was submitted.
- Overview loads the actual matching report; Basket and Paper lab retain the
  same navigation; keyboard selection and visible focus observed.
- 390px Overview/Proof/example layouts inspected; example table scrolls internally
  without page-wide overflow. 640px reflow inspected. Native browser zoom shortcuts
  did not change this embedded browser's zoom, so actual 200% zoom is unverified.
- Reduced-motion stylesheet checked: scroll is automatic, animation/transition
  durations suppressed and active transforms removed. OS preference emulation was
  not available; no runtime reduced-motion claim is made.
- Local API failure is unavailable, stale fixture/current chain is missing evidence,
  not a false pass. Tests cover stale/missing quotes, publication pending/failure,
  wrong/unavailable RPC, genuine arithmetic/hash mismatches and restoration.
- Public relayer health ready with intended chain/contracts. Health alone is not
  proof of publication; only the directly read report was treated as verified.

## Limits
This is a focused development/design release, not a complete WCAG or security
audit. No native-wallet transactions, interviews, adoption claims, video or form
submission were performed. Broadcast/storage crash atomicity remains documented
in PUBLICATION_RETRY_REVIEW.md. No monitor was recreated or engine forced.
