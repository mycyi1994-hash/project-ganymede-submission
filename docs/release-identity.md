# Release source and paper portfolio identity

The public release is built from a committed revision promoted to `main` and `codex/design-refinement`. The Cloudflare deployment message records the source commit; release evidence under `outputs/` records the resulting Worker version. Never deploy stale output or another checkout without preserving current UI and security changes.

## Visitor isolation

- A successful portfolio GET creates a 256-bit random, host-only Secure/HttpOnly/SameSite=Strict cookie when paper mode has no existing visitor identity. GET performs no database writes.
- The cookie is valid for 30 days. Clearing it, using another browser, or expiry starts a separate portfolio. It is a browser credential, not wallet authentication or cross-device account recovery.
- Only the SHA-256 digest becomes the ledger subject. Wallet headers and payload addresses are metadata, never ownership credentials.
- POST and DELETE require the existing session; cross-origin/cross-site requests are rejected. Live mode does not accept paper cookies. Trusted identity headers still require the explicit authenticating-edge gate.
- Legacy shared and address-based records are retained but are not assigned to new anonymous visitors. No unverifiable ownership migration is performed.
- Cookies are not a defense against a compromised browser or stolen credentials. No raw cookie values should be logged or included in release evidence.

## Validation

`tests/portfolio-session.test.mjs` calls the real portfolio handlers and repository against an isolated SQLite ledger with the application schema. Two visitors share a claimed wallet address but have separate reads and saves; the second cannot redeem the first's position. Owner redemption is settled locally and leaves the other visitor untouched. Missing sessions, forged headers, cross-site mutations and paper cookies in live mode are rejected.

The local test performs no remote writes, transactions, or production engine runs. Production verification uses read-only requests and rejected unauthenticated requests.
