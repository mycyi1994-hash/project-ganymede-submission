# Build provenance

Production source revision: `28e0ce2ddfabaa87ebdc73007a37d84460bdfa46`.

This is a source snapshot, not a claim that the entire project was newly built for this event. The original repository remains private. The entries below were exported from its Git history; reviewers can inspect current implementations and tests, and request original history access from the team if needed. No old secrets, local environment files or full private Git history are published.

```text
8b9b2abf3f11180f9394446500687dc7fee406ca 2026-09-23T08:01:50Z Move settlement rail to X Layer testnet
0feca681aa6ea5e8bb3da8c18e02767af4c0286b 2026-09-23T09:15:34Z Add xStocks basket with on-chain Proof of NAV
c3016cf16393ca1532439253f91ceef7b4ca7573 2026-09-23T09:41:34Z Add keyless contract verification export
4cb6dc94d306449552898884f9447b3dfa81a528 2026-09-23T10:51:59Z Deploy settlement contracts to X Layer testnet
a8ea5f2b0af186a53530d4d1b36cf684527f5458 2026-09-23T11:05:31Z Deploy the relayer and app to Cloudflare Workers
b8586424f549dd4d46d2cfaec1d4489d4410893b 2026-09-23T11:06:25Z Pace xstocks:check calls to the trial OnchainOS rate limit
f730252dae6187e221e8586a2d5af142a47ac057 2026-09-23T11:10:09Z Record the X Layer deployment in the Dev Day notes
a79bb78b60de31737ede0723c65d4c5c2bb7eead 2026-09-23T11:17:11Z Record the first on-chain GMD US TECH x NAV
f6f333e53c6cd6d84ea859d4db3e283eebb63af1 2026-09-23T11:27:43Z Note explorer source verification in the Dev Day notes
911af9119fdd266e3f0f2599eaf01ab319eb8b8d 2026-09-23T20:38:30+09:00 Merge pull request #2 from mycyi1994-hash/claude/korean-query-6agq3t
f35288c2b893ca389d3a874d626b962d5ae23a27 2026-09-23T21:11:17+09:00 Refine Ganymede navigation, strategy cards and NAV presentation
a6a3a26451a1a67d09964bab308acd05faa5937e 2026-09-23T21:43:04+09:00 Clarify strategy details, paper estimates and NAV evidence
c74dc696fbeedeb2b611ab38026184e71c08caee 2026-09-23T22:08:47+09:00 Refine paper portfolio layout and data availability states
3aa286aaf774a4d488ef2551d1c2737126e953b8 2026-09-23T22:26:26+09:00 Keep primary navigation consistent across all public screens
8222b591bed948695b7be56e78687eaaf3b5ac88 2026-09-23T23:28:57+09:00 Focus submission design on tokenized stock NAV evidence
c98e7eab02f5ce97d250d583a0772e180d2843a5 2026-09-24T00:21:30+09:00 Keep public reads free of writes and preserve NAV evidence through outages
27350f287a7066549079771f0f09e4db4b722415 2026-09-24T00:21:30+09:00 Verify NAV directly in the browser and separate record validity from pricing freshness
e5d1d8f5213d89addb6ed43b97568c491d7c6015 2026-09-24T03:09:20+09:00 Redesign Ganymede with the Clearform visual system
5f2fff8cbd475fb0b771a18272c81efc5012cff7 2026-09-24T09:58:10+09:00 Preserve deployed identity boundary while restoring Clearform
1ff54638f0449990180c45417870599a925441bc 2026-09-24T10:13:16+09:00 Isolate paper portfolios by private browser session
5af1ea0796cab77be6aaaa1d7b01d9a8b24cd8b2 2026-09-24T10:20:43+09:00 Focus the product journey on USTX composition and NAV evidence
4641ddc8248f563c60cf4b1a7dfdb71af7828b8a 2026-09-24T10:31:33+09:00 Demonstrate real NAV verification failures on a local document copy
9e6d3eeae8f37bc66bbcb6b9d3ae323d4cb7c9cd 2026-09-24T10:33:12+09:00 Keep verification experiment stable during background refresh
95da39e64f005ffd6b806ac63eef6f6b49bba114 2026-09-24T10:56:27+09:00 Align submission documentation with verified product behavior
28e0ce2ddfabaa87ebdc73007a37d84460bdfa46 2026-09-24T11:04:32+09:00 Patch application dependencies and document submission access requirements
```

Publication adjustments: AGENTS.md is review-specific; .openai/hosting.json uses a placeholder project ID; relayer/wrangler.jsonc uses a separate example Worker name and placeholder D1 ID; README and submission notes reference this snapshot. No app, lib, contracts, tests or lockfile changes were made for publication.
