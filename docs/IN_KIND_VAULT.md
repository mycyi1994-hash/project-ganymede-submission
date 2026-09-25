# In-kind creation and redemption with the real xStocks

The testnet USTX fund holds no assets: it burns the demo dollars an investment brings and mints new
ones for a redemption. A fund with real money would have to hold the xStocks.
`contracts/GanymedeBasketVault.sol` is the in-kind half of that, built the way ETF creation and
redemption work: shares are created only by delivering the constituents to the vault, and
redeeming them pays the constituents back. The first creation takes a fixed quantity of each
constituent per share; after that every share is an equal claim on everything the vault holds, so
later creations deliver in proportion to the holdings and redemptions pay out in proportion. The
vault prices nothing and has no owner.

It is not deployed, and nothing here holds real assets. `npm run fork:vault` (in `onchain/`) runs it
against the real xStocks on a fork of X Layer mainnet, in memory, with local test accounts and no key:

1. AAPLx, MSFTx and NVDAx are bought on their Uniswap V3 pools with USDG, and each pool's ERC-4626
   wrapper is redeemed for the xStock itself (`contracts/testing/ForkPoolBuyer.sol`, test-only). On
   the fork the USDG comes from the METAx pool, outside the basket.
2. The vault is deployed with MAG3's units per share (`public/baskets/mag3/basket.json`) for the
   first creation, the same units the MAG3 records on X Layer Testnet value.
3. 10 shares are created by delivering those units, rounded up plus a small allowance.
4. 4 shares move to a second account, which redeems them for 4/10 of the holdings.
5. The other 6 are redeemed, leaving only rounding allowances in the vault.

## What the fork showed

xStocks keep balances as shares times a multiplier. A transfer can arrive a base unit short: sending
10^18 AAPLx (one token) delivered 10^18 − 1. And a dividend, a split or a fee paid through the
multiplier changes every balance at once. A vault that counts fixed base units would strand a
dividend in the vault and stop working after a fee, so `GanymedeBasketVault` counts proportions
instead:

- creation takes the proportional amount rounded up plus `ROUNDING_ALLOWANCE` (4 base units, 4 ×
  10^-18 of a token) and refuses the call if any token arrives short of the proportional amount, so a
  fee-on-transfer token cannot dilute the holders;
- redemption pays the proportional amount rounded down less the same allowance, so rounding always
  favours the shares that stay;
- the first creation must be at least one whole share, and every creation names the most of each
  token it will deliver, so no one can make shares expensive by creating a dust share and donating
  to the vault.

`onchain/test/GanymedeBasketVault.test.ts` covers these with a multiplier token like the xStocks
(a 10% dividend reaches the redeemers; a 1% fee does not stop the last redemption), a
fee-on-transfer token and a donation.

## The run on 25 September 2026

```text
forked X Layer mainnet at block 71593193 (2026-09-25T18:50:29.000Z), in memory only

1. bought on the X Layer pools and unwrapped
   AAPLx  1.176525 for $400 USDG in pool 0xc44bd9c8589026d28d1632d7b86b2efb6cdc8fd2
   MSFTx  0.772065 for $400 USDG in pool 0x66187278490a70a8ac26a6e159eb045f82dbfb57
   NVDAx  1.783307 for $400 USDG in pool 0x2a2b11730c2b6d99a58034a869dd810d7300a7b2

2. vault deployed on the local fork with MAG3's units per share for the first creation

3. created 10 shares by delivering MAG3's units × shares, rounded up, plus 4 base units:
     AAPLx  0.981335 (981334569096697123 base units)
     MSFTx  0.645733 (645732529530595284 base units)
     NVDAx  1.483168 (1483168328965507173 base units)
   after creation: 10 shares outstanding
     AAPLx  held 0.981335, per share 0.098133 (MAG3 units 0.098133)
     MSFTx  held 0.645733, per share 0.064573 (MAG3 units 0.064573)
     NVDAx  held 1.483168, per share 0.148317 (MAG3 units 0.148317)

4. a second account received 4 shares and redeemed them for 4/10 of the holdings:
     AAPLx  0.392534 (392533827638678844 base units; the vault sent 392533827638678845)
     MSFTx  0.258293 (258293011812238108 base units; the vault sent 258293011812238109)
     NVDAx  0.593267 (593267331586202864 base units; the vault sent 593267331586202865)
   after that redemption: 6 shares outstanding
     AAPLx  held 0.588801, per share 0.098133 (MAG3 units 0.098133)
     MSFTx  held 0.387440, per share 0.064573 (MAG3 units 0.064573)
     NVDAx  held 0.889901, per share 0.148317 (MAG3 units 0.148317)

5. the creator redeemed the other 6 shares
   at the end: 0 shares outstanding
     AAPLx  held 0.000000, per share 0.098133 (MAG3 units 0.098133)
     MSFTx  held 0.000000, per share 0.064573 (MAG3 units 0.064573)
     NVDAx  held 0.000000, per share 0.148317 (MAG3 units 0.148317)
     AAPLx  5 base units of rounding allowance stay in the vault
     MSFTx  5 base units of rounding allowance stay in the vault
     NVDAx  5 base units of rounding allowance stay in the vault

every step matched: shares were created only against the xStocks and redeemed for their share of them.
```

## What this does not cover

The fork proves the token mechanics with the real xStock contracts and pools, not an operation.
Nothing was bought or held on mainnet, no custody, licensing or issuer agreement exists, and the
vault has not been audited. Creation in kind needs a participant that already holds the xStocks; a
cash path that buys them through OKX DEX, and rebalancing, are not built. Redemption pays every
constituent in one call, so a paused xStock, or a vault address its issuer restricts, stops
redemptions until it is lifted. Corporate actions arrive only as the multiplier changes described
above.
