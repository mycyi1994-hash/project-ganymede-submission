# Clearform design implementation

The selected Clearform direction uses a porcelain background, graphite typography, translucent stock layers and a shared navigation shell. `app/globals.css` now loads `app/clearform.css` as the sole visual system; earlier refinement stylesheets are not loaded.

## Screens

- Overview: six-layer stock sculpture, HTML-rendered published NAV, pricing freshness, basket constituents, evidence flow and paper strategy links.
- Funds: featured GMD USTX basket followed by four filterable paper strategies. USD and KRW remain distinct.
- All four strategy pages: Overview, Model results, Holdings, How it works, Risks & documents, allocation simulator and review dialog.
- Portfolio: loading, empty, populated, pending removal, refresh failure and removal confirmation.
- Proof of NAV: last published record, separate pricing state, three independent checks, composition, registry details, publication history and original document.
- Shared wallet feedback, strategy finder, operations workspace/access restriction, not-found and error surfaces.

## Corrections found during browser review

- Main navigation retains all four links on narrow screens; the current section stays marked.
- The sculpture blends into the background and its plinth joins the live NAV panel.
- Negative model-return bars extend below the same zero baseline as positive bars.
- Holding bars represent actual weights rather than scaling the largest holding to 100%.
- Mobile holdings prioritize asset names and weights; supporting methodology remains in its own tab.
- Allocation review starts at its heading instead of scrolling directly to its bottom buttons. Dialogs retain Escape handling and focus restoration.
- Wallet error feedback can be dismissed by its close button or Escape.
- Pricing that fails on the first load does not claim a previous record exists. A verified historical record still does not imply pricing recovery.
- Visible dates use English and UTC; monetary units remain explicit.

## Validation

Browser inspection used local public-data fixtures with all mutation requests blocked. Populated portfolio and operations data were explicitly local test fixtures. No live allocation, redemption, engine cycle or wallet transaction was executed.

- Overview inspected at 390, 1440, 1920 and 2560 pixel widths.
- Mobile navigation, detailed holdings, allocation review and focus at 360 pixels; proof, portfolio states and removal confirmation at 390 pixels.
- All four detail routes and all five tabs checked, including tablet layout at 768 pixels. Core model results also checked separately after the initial click happened before hydration completed.
- Main page overflow checks, keyboard arrow navigation for tabs, Escape and focus restoration for dialogs, missing-wallet feedback, proof JSON expansion, unavailable data and 404 routing checked.
- Proof browser verification reached 3/3 against the existing historical record and public X Layer RPC.
- Production build and 42 existing tests pass. Updated render expectations reflect the new copy and sentence-case navigation. App TypeScript check passes; changed-file lint has zero errors and two intentional static-image recommendations.
- Reduced motion is implemented in CSS. Real connected-wallet, network-switch and provider-rejection flows were not exercised against a live wallet. The error boundary is implemented and builds; server failures were exercised through API-error states, not by deliberately crashing the application.

Asset provenance is in `public/ASSET-CREDITS.md`. The hero WebP is 68.7 kB and fonts are self-hosted with their OFL licenses.

The known pricing/publication delay is a separate backend issue. This visual release does not claim its recovery. The scheduled read-only monitor remains active under its existing end time.


## USTX journey refinement (2026-09-24)

The approved palette (paper #f7f8fa, surface #ffffff, ink #20262f, copy #566274, line #dde3e9) and Instrument Sans / Source Sans 3 remain unchanged. Overview introduces basket operators and analysts, then leads into Funds. Funds presents USTX composition and price provenance before the separate paper strategy lab. Proof reads in calculation → chain record → comparison order. Portfolio and crypto details explicitly identify their simulation scope and offer a route back to USTX.

The Funds table uses the latest pricing snapshot, with its timestamp, and never labels it independently verified. Proof uses the document matching the selected chain record; missing matching evidence stays unavailable. The added calculation total sums integer USD-micro holding values and clearly separates display rounding from verification precision. No trading, pricing policy or verification algorithm changes are included.


## Browser verification experiment (2026-09-24)

After all three original evidence checks pass, Proof offers a local copy experiment. It adds exactly USD 1 to the first holding price without changing its reported value, NAV or chain record, then calls the same `verifyComposition` function used for the original document. Restore verifies the original bytes again. The experiment does not fetch, submit, sign or persist anything. Results are actual returned checks, not preset pass/fail illustrations. Missing documents remain pending with retry guidance; actual arithmetic/hash mismatches and unavailable RPC reads have separate messages. Pricing freshness continues to be displayed independently.

Regression coverage verifies a single-field edit, real hash and arithmetic failures, unchanged original bytes and successful restoration.
