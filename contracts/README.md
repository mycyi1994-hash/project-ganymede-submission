# Ganymede settlement contracts

These contracts separate the fund's off-chain asset custody and execution from its on-chain share and disclosure records.

- `GanymedeFundShare.sol` is a six-decimal, permissioned fund-share ledger. Only allowlisted investors can hold or transfer shares. Subscription and redemption settlement identifiers are one-time and idempotent.
- `GanymedeNavRegistry.sol` publishes monotonic NAV snapshots and rebalance evidence hashes.

Production deployment requirements:

1. Independent administrator, issuer, transfer-agent and publisher multisigs.
2. KYC/AML before allowlisting an investor (on GIWA, also an Upbit Korea Dojang Verified Address check).
3. External custody and cash settlement confirmation before minting or burning shares.
4. Contract audit, deployment rehearsal, monitoring and emergency runbook.
5. A licensed fund, transfer agent, custodian and approved offering documents.

The backend never stores an EVM private key. It submits idempotent requests to a separately operated settlement relayer (`relayer/`) configured through hosted secrets. The contracts are plain EVM and deploy unchanged to X Layer (default) or GIWA Sepolia.
