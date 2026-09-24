# Competition refinement execution plan

Objective: make the existing Clearform product a clear, credible NAV review tool,
then verify and release the complete journey. Implementation completion is not
customer validation or an award prediction.

## 1. Evidence status and publication policy
- Expose the actual configured quote-age policy through the read-only API.
- Separate pricing-cycle freshness, quote eligibility, publication status and
  verification. Never equate a recent cycle with fresh underlying quotes.
- Surface publication delay/failure beside the NAV and on Proof.
- Check cooldown, duplicate/retry and partial-failure handling before changing it.
- Gate: tests cover recent pricing with old/failed publication and API failure;
  no forced production cycle or changed operator settings.

## 2. Design and primary journey
- Keep porcelain #f7f8fa, white #ffffff, graphite #20262f, copy #566274,
  borders #dde3e9; retain Instrument Sans and Source Sans 3.
- Shared navigation foregrounds Basket and Verify; the existing paper lab remains
  accessible but secondary. Wallet connection is optional for verification.
- Overview leads with the reporting problem and a real verification interaction.
- Proof presents result and limitations before supporting calculation details.
- Visual idea: one report, its record, and the changed value side by side;
  no extra decorative card grid or replacement brand direction.
- Gate: inspect desktop/mobile screenshots and all navigation routes.

## 3. Reusable report verification
- Add a second clearly labelled example report and document its schema/version.
- Reuse real arithmetic/hash checks, preserving the pinned live product boundary.
- Example checks must never claim live chain verification or real publication.
- Show exactly which field changed, original/edited values and actual outcomes.
- Gate: both original reports pass their intended checks, changes fail and restore
  passes; malformed/unsupported reports fail safely.

## 4. Failure and usability validation
- Exercise missing document, stale quotes/cycle, delayed publication, API/RPC
  failure and genuine mismatch independently.
- Check keyboard, mobile, zoom and reduced-motion core journey.
- Review publication authority, chain/registry restrictions and retry safety.
- Record concrete evidence and remaining limits, not broad security claims.

## 5. Release and submission evidence
- Run build/tests; compare latest deployed source before release; preserve trusted
  identity gate and production configuration. Verify all main public routes.
- Update public submission snapshot and review docs with this release and scoped
  changes that demonstrate build-period work; keep original private history private.
- Record final source/deployment revisions and inspect production core journey.
- Customer interviews, video, entry form and terms acceptance remain separate
  user-owned actions; do not invent adoption metrics or perform outreach.

## Progress
- Plan created from current clean source and API/UI inspection.
- Stage 1 in progress. Stages 2–5 pending.
- Stage 1 implemented: API returns the publisher's configured maximum quote age;
  NAV preview and Proof distinguish publication state from pricing-cycle state.
  Historical publication, pending/failed attempts and read failure have separate
  labels. No production policy changed.
- Validation: production build passed; 11 focused NAV/proof/publication tests
  passed. Browser validation and retry/authority review are still pending.
- Stages 2–3 implementation: shared navigation now Basket / Verify NAV / Paper
  lab; Overview embeds a real direct-RPC verification experiment; Proof places
  results first. Optional wallet is visually secondary. Two synthetic report
  profiles share calculation checks without relaxing the live USTX boundary.
- Root tests: 51 passed after navigation expectations were updated. Browser:
  desktop Overview/Proof inspected; stale local fixture vs current RPC correctly
  leaves missing evidence unverified; both example originals pass, edits fail;
  Enter activation works; 390px example layout has internal table scrolling and
  no page-wide overflow. Corrected misleading shared-verifier example copy found
  during browser review; tests now assert examples never say on-chain NAV.
- Pending backend finding: relayer classifyRevert treats StalePublication as
  confirmed without proving the requested payload matches the existing record.
  Review/fix that distinction and receipt/retry handling before release.
- A combined command to prepare a fresh-data secondary preview server was
  rejected by automatic approval review without a specific reason. No second
  server was created by that command. Existing read-only preview remains usable.
- Release, full failure/browser audit and public snapshot update remain pending.
- Backend corrections implemented: stale NAV requests query the registry's exact
  publishedPayload tuple before being considered confirmed; otherwise return 409.
  The submitter serializes async submissions, persists the transaction hash before
  waiting, and reconciles submitted receipts on retry without rebroadcasting.
- Relayer typecheck and five mocked transaction-lifecycle tests pass. Dependency
  audit now reports zero after compatible lockfile updates. These tests use no
  private key or live transaction. Runtime deployment validation remains pending.
- Production rechecked: app is still source 28e0ce2 / version
  8e4a251b-a187-4680-9d8d-af8db977154a; relayer latest deployment is
  5ec81f5d-53ce-48fe-ae96-65c5b4b61f29 (2026-09-23 12:43 UTC).


## Release status
Stages 1–3 implemented and deployed. Stage 4 automated and supported browser
checks passed, with native 200% zoom and runtime reduced-motion emulation explicitly
unverified in this environment (see REFINEMENT_RELEASE.md). Stage 5 app/relayer
released; public export build passed; publication of the export is in progress.
