# Report examples v1

The example package version is `ganymede-report-example/v1`. Its fields are
`schema`, `name`, `profile`, `canonical` and `document`. Only that version is
bundled by the UI; arbitrary uploads or version negotiation are not supported.

`canonical` is the exact JSON string checked by SHA-256. The report contains
productId, pricingChainIndex, asOf, basketFixedAt, navPerShareMicros and holdings.
Each holding contains symbol, address, weightBps, unitsWad, priceMicros,
valueMicros, priceTime and priceSource. Integer monetary values are decimal
strings; units use 18 decimals and USD values use 6. Per-holding division rounds
down before summing. Dates are UTC ISO strings. Weights total 10,000 basis points.

Profiles explicitly select a product ID, pricing chain and unique symbols.
The same arithmetic validator handles the two- and three-holding synthetic
examples. The live verifier separately pins USTX's six symbols, product, network
and registry; it rejects both synthetic products.

Example fingerprints are derived locally from bundled original bytes. Matching
them demonstrates reproducibility, not independent authenticity. Examples have
no real prices, customers, transactions or chain read. The live USTX path obtains
its reference independently from the pinned public RPC.
