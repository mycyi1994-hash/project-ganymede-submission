# Journey stages 1–3 — design handoff

Base: 4ac37eb on codex/design-refinement. Work branch: codex/journey-stages-1-3.

Scope: preserve Clearform; connect understanding, the real report experiment and full evidence. No new animation or backend changes.

- Overview: one report's six holding values and sum precede an explicitly verified original, then local price edit/restore and a full evidence CTA. Removed repeated explanatory sections and strategy cards.
- Basket: composition is the main content; selecting a holding highlights its row and contribution. Pricing snapshot stays explicitly separate from published proof.
- Verify NAV: jump links match content order; results and experiment precede calculation and chain record. Synthetic examples are collapsed and clearly offline. Status and verification limitations remain visible.
- Paper lab: crypto strategy catalog now lives beside the paper portfolio; empty state leads to it. Strategy detail navigation selects Paper lab and returns to its catalog.
- Motion work (stage 4) is deferred. Existing motion preferences are preserved.

Validation: app build/test; app-scoped typecheck using work/tsconfig.app-check.json; browser preview uses GET-only public market/report reads and a local empty-portfolio fixture, never production writes. Live direct RPC remains the proof anchor.

Release coordination: changes are prepared separately from Claude's cleanup. Do not overwrite concurrent production changes. Merge/review this branch with the current release owner before deployment and public submission export. This change has not been deployed.

Verified on this change:
- Production build and 52 tests passed (including journey separation and proof reading order).
- App-scoped TypeScript check passed. The previously reported repository-wide configuration issue remains Claude's separate task.
- Changed-file lint: zero errors, six existing warnings (image and navigation APIs).
- Browser: real report original matched; edited price produced hash and arithmetic mismatches; restore returned original displayed price and both matches.
- Basket selection by keyboard; empty-portfolio strategy entry; strategy detail navigation; direct proof 3/3; synthetic examples collapsed.
- Desktop 1440px and mobile 390px reviewed. Home, Basket, Proof and Paper lab had no page-wide horizontal overflow at 390px. Portfolio preview uses an empty fixture; no paper allocation was submitted.
- Native 200% zoom and runtime reduced-motion remain outside this focused stages 1–3 review; no completion claim for those earlier gates.
