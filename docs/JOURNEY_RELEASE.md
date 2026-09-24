# Five-stage journey release — 2026-09-24

The Clearform journey now connects basket understanding, original verification,
local price edits and detailed evidence. This release integrates Claude's review
branch through 1e5cbf6, preserving the source identity boundary, exact publication
checks, typecheck configuration, unused-style removal and narrow-screen fixes.

## Implemented
1. Shared navigation separates Paper lab visually. Strategy details return to the lab.
2. Overview presents one verified report's six holding values and sum before the edit experiment; a full-evidence action follows the result.
3. Basket prioritizes composition and selected holding contribution. Proof navigation matches reading order. Offline examples are collapsed. Crypto strategy browsing lives with paper allocations.
4. One 500ms hero entrance; 180ms selection feedback; 240ms result transitions; a brief changed-price highlight. Actual local verification establishes the experiment baseline and every edit/restore result; no fake success or timed verification delay. Short result summaries retain expandable exact check details. All added motion is disabled by prefers-reduced-motion.
5. App build/typecheck/tests, relayer tests/typecheck and browser checks precede deployment. Runtime/public-export results are recorded below after release.

## Validation scope
- Desktop and 390px mobile: navigation, composition selection, baseline/edit/restore, consistent result placement, 3/3 direct-chain verification, collapsed examples.
- Read-only local failure preview: /api/xstocks 503 yields unavailable and retry, never a successful check.
- Preview portfolio is an explicit empty local fixture; no transaction or allocation was made during review.
- Existing tests cover stale publication, quote status, unavailable RPC and report mismatches. These are distinct from runtime failure-preview checks.
- Reduced-motion CSS is inspected; the connected browser currently reports no preference for reduced motion. Native 200% zoom and runtime reduced-motion testing remain unverified; narrow viewport checks are not a substitute. This does not claim a complete accessibility audit.
- No relayer behavior change is needed for this UI release; the already deployed exact-payload/receipt reconciliation implementation is retained.

## Release evidence
- Application source: e8631c26ca9f6b384c32604c96bd0e3b92955111 (integrated on original main).
- Worker version: 19417a86-37cf-4f6f-9d51-2c6c71426ac5.
- Deployed with remote variables preserved and existing five-minute schedule retained.
- Root typecheck/build and 57 tests passed. Relayer 11 tests and typecheck passed.
- Full-tree lint: zero errors, seven existing warnings.
- At 390px the final experiment outcome measured 440px for both original and edited states; at desktop it measured 245px. These observations do not imply no layout shift at every text scale.
- This supersedes the deployment-pending note in JOURNEY_STAGES_1_3.md.
- Post-deploy: Overview/Basket/Paper lab/Proof and market/health/portfolio/xstocks GETs all returned HTTP 200.
- Production browser: original matched; local $1 edit produced both mismatches; restore matched again. Full proof passed 3/3 against the direct RPC record effective 2026-09-24 06:16:05 UTC.
- Production mobile Proof: 390px viewport, 375px document width, offline examples closed. All four navigation links fit within the viewport.
- Public submission export: independent root typecheck/build and 57 tests passed.
