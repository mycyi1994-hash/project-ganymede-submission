# Publication retry review

The registry authorizes only its publisher. The relayer requires its bearer
token and derives contract addresses and chain from its own configuration, not
the incoming request. The application's trusted identity-header gate remains
unchanged. This is a scoped code review, not a contract/security audit.

## Corrected behavior
- StalePublication alone does not prove a request succeeded. The relayer now
  computes the exact Solidity ABI-encoded NAV payload hash and checks the
  registry's publishedPayload mapping. Only true permits confirmation.
- Concurrent submissions are serialized across network awaits by an explicit
  promise queue. A rejected operation does not prevent later operations.
- The transaction hash is persisted immediately after broadcast, before receipt
  waiting. Submitted requests re-read that hash's receipt; RPC unavailability
  leaves them submitted rather than authorizing another broadcast.
- API fast-path caching applies only to confirmed requests so submitted requests
  reach receipt reconciliation.

## Evidence and limits
Run `npm ci`, `npm run typecheck` and `npm test` inside relayer. The tests mock
transport and storage, execute the submitter request handler, and cover exact
stale-payload checks, pending receipt recovery, unreadable receipt, simultaneous
duplicates and queue recovery. No production engine cycle or transaction was
triggered for tests.

Chain broadcast and database writes are not an atomic operation: a process crash
or storage failure between broadcast and hash persistence remains a boundary.
The registry's payload guard prevents duplicate confirmed NAV state, but this
review does not claim exactly-once transaction broadcast under all failures.
Cached historical confirmations are not retroactively reclassified. Browser
verification still independently compares actual chain and report data.
