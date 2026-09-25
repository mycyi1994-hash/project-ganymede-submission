import { expect } from "chai";
import hre from "hardhat";
import { maxUint256, zeroAddress } from "viem";

const SHARE = 1_000_000n;
const ALLOWANCE = 4n;
// Three constituents with awkward units per share, so rounding shows up.
const UNITS = [1_234_567n, 7_654_321n, 3n];

async function deploy() {
  const [admin, creator, other] = await hre.viem.getWalletClients();
  // Deployed one at a time, so the deployer's nonces never race.
  const deployDollar = () => hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
  const tokens: Awaited<ReturnType<typeof deployDollar>>[] = [];
  for (let index = 0; index < UNITS.length; index++) tokens.push(await deployDollar());
  for (const token of tokens) {
    for (const wallet of [creator, other]) await token.write.claim({ account: wallet.account });
  }
  const vault = await hre.viem.deployContract("GanymedeBasketVault", ["Test basket in kind", "TBK", tokens.map((token) => token.address), UNITS]);
  for (const token of tokens) {
    await token.write.approve([vault.address, maxUint256], { account: creator.account });
    await token.write.approve([vault.address, maxUint256], { account: other.account });
  }
  const held = () => Promise.all(tokens.map((token) => token.read.balanceOf([vault.address])));
  return { admin, creator, other, tokens, vault, held };
}

describe("GanymedeBasketVault", () => {
  it("refuses an empty, mismatched, zero, repeated or non-contract basket", async () => {
    const { tokens, creator } = await deploy();
    const [a, b] = tokens.map((token) => token.address);
    for (const [addresses, units] of [
      [[], []],
      [[a, b], [1n]],
      [[a, b], [1n, 0n]],
      [[a, a], [1n, 1n]],
      [[a, creator.account.address], [1n, 1n]],
      [[a, zeroAddress], [1n, 1n]],
    ] as const) {
      await expect(hre.viem.deployContract("GanymedeBasketVault", ["x", "x", [...addresses], [...units]])).to.be.rejectedWith("InvalidBasket");
    }
  });

  it("creates the first shares for the initial units, rounded up, and later ones in proportion to the holdings", async () => {
    const { vault, creator, other, tokens, held } = await deploy();
    const shares = 2_500_001n; // 2.500001 shares
    const [owed, createIn] = await vault.read.amountsFor([shares]);
    UNITS.forEach((units, index) => {
      const product = units * shares;
      expect(owed[index]).to.equal(product / SHARE + (product % SHARE === 0n ? 0n : 1n));
      expect(createIn[index]).to.equal(owed[index] + ALLOWANCE);
    });
    const before = await Promise.all(tokens.map((token) => token.read.balanceOf([creator.account.address])));
    await vault.write.create([shares, (await vault.read.amountsFor([shares]))[1]], { account: creator.account });
    const after = await Promise.all(tokens.map((token) => token.read.balanceOf([creator.account.address])));
    tokens.forEach((_, index) => expect(before[index] - after[index]).to.equal(createIn[index]));
    expect(await held()).to.deep.equal(createIn);
    expect(await vault.read.totalSupply()).to.equal(shares);
    // A donation of token 0 raises what every share holds, so the next creator delivers that much more.
    await tokens[0].write.transfer([vault.address, 1_000_000n], { account: other.account });
    const holdings = await held();
    const [nextOwed] = await vault.read.amountsFor([shares]);
    holdings.forEach((amount, index) => expect(nextOwed[index]).to.equal((amount * shares + shares - 1n) / shares));
    await vault.write.create([shares, (await vault.read.amountsFor([shares]))[1]], { account: other.account });
    const perShare = await vault.read.holdingsPerShare();
    // Both holders now own the same holdings per share, the donation included.
    expect(perShare[0] >= ((holdings[0] * SHARE) / shares)).to.equal(true);
  });

  it("redeems each holder's share of the holdings, a donation included", async () => {
    const { vault, creator, other, tokens, held } = await deploy();
    await vault.write.create([10n * SHARE, (await vault.read.amountsFor([10n * SHARE]))[1]], { account: creator.account });
    await vault.write.transfer([other.account.address, 4n * SHARE], { account: creator.account });
    // Something paid to the vault, like a dividend through a token's multiplier, belongs to the shares.
    await tokens[1].write.transfer([vault.address, 5_000_000n], { account: creator.account });
    const holdings = await held();
    const [, , redeemOut] = await vault.read.amountsFor([4n * SHARE]);
    holdings.forEach((amount, index) => {
      const exact = (amount * 4n) / 10n;
      expect(redeemOut[index]).to.equal(exact > ALLOWANCE ? exact - ALLOWANCE : 0n);
    });
    const before = await Promise.all(tokens.map((token) => token.read.balanceOf([other.account.address])));
    await vault.write.redeem([4n * SHARE], { account: other.account });
    const after = await Promise.all(tokens.map((token) => token.read.balanceOf([other.account.address])));
    tokens.forEach((_, index) => expect(after[index] - before[index]).to.equal(redeemOut[index]));
    expect(after[1] - before[1] >= 2_000_000n).to.equal(true, "the holder received 4/10 of the donation");
    await vault.write.redeem([6n * SHARE], { account: creator.account });
    expect(await vault.read.totalSupply()).to.equal(0n);
    // Only rounding allowances remain: a few base units of each token.
    for (const amount of await held()) expect(amount <= 3n * ALLOWANCE + 2n).to.equal(true);
  });

  it("keeps redeeming when a multiplier token pays a dividend or takes a fee", async () => {
    const [creator, other] = await hre.viem.getWalletClients();
    const token = await hre.viem.deployContract("MultiplierToken", [creator.account.address, 10n ** 24n]);
    const vault = await hre.viem.deployContract("GanymedeBasketVault", ["Multiplier", "MUL", [token.address], [10n ** 18n]]);
    await token.write.approve([vault.address, maxUint256], { account: creator.account });
    await token.write.setMultiplier([1_003_269_012_539_818_700n]); // AAPLx's multiplier on 25 September 2026
    await vault.write.create([10n * SHARE, (await vault.read.amountsFor([10n * SHARE]))[1]], { account: creator.account });
    await vault.write.transfer([other.account.address, 5n * SHARE], { account: creator.account });
    // A 10% dividend reaches the holders instead of staying in the vault...
    await token.write.setMultiplier([1_103_595_913_793_800_570n]);
    const [, , out] = await vault.read.amountsFor([5n * SHARE]);
    await vault.write.redeem([5n * SHARE], { account: other.account });
    expect(out[0] > (55n * 10n ** 17n) - 10n).to.equal(true, "half of 10 tokens plus the 10% dividend");
    // ...and a 1% fee does not stop the last holder from redeeming.
    await token.write.setMultiplier([1_092_559_954_655_862_564n]);
    await vault.write.redeem([5n * SHARE], { account: creator.account });
    expect(await vault.read.totalSupply()).to.equal(0n);
    expect((await token.read.balanceOf([vault.address])) <= 3n * ALLOWANCE).to.equal(true);
  });

  it("needs a whole first share and honours each creation's maximum amounts", async () => {
    const { vault, creator, other, tokens } = await deploy();
    const [, quote] = await vault.read.amountsFor([SHARE]);
    // A dust first share, which a donation could then make expensive, is refused.
    await expect(vault.write.create([SHARE - 1n, quote], { account: creator.account })).to.be.rejectedWith("InvalidAmount");
    await expect(vault.write.create([SHARE, quote.slice(1)], { account: creator.account })).to.be.rejectedWith("InvalidAmount");
    await vault.write.create([SHARE, quote], { account: creator.account });
    // After a donation, a creator who quoted before it is protected by their maximums.
    const [, stale] = await vault.read.amountsFor([SHARE]);
    await tokens[0].write.transfer([vault.address, 5_000_000n], { account: other.account });
    await expect(vault.write.create([SHARE, stale], { account: other.account })).to.be.rejectedWith("ExceedsMaximum");
    const [, fresh] = await vault.read.amountsFor([SHARE]);
    await vault.write.create([SHARE, fresh], { account: other.account });
    expect(await vault.read.totalSupply()).to.equal(2n * SHARE);
  });

  it("rejects zero amounts, overdrafts, missing approvals, transfers to the vault and from the zero address", async () => {
    const { vault, creator, other, tokens } = await deploy();
    await expect(vault.write.create([0n, [0n, 0n, 0n]], { account: creator.account })).to.be.rejectedWith("InvalidAmount");
    await vault.write.create([SHARE, (await vault.read.amountsFor([SHARE]))[1]], { account: creator.account });
    await expect(vault.write.redeem([SHARE + 1n], { account: creator.account })).to.be.rejectedWith("InsufficientBalance");
    await expect(vault.write.redeem([0n], { account: creator.account })).to.be.rejectedWith("InvalidAmount");
    await expect(vault.write.transfer([vault.address, 1n], { account: creator.account })).to.be.rejectedWith("InvalidAmount");
    await expect(vault.write.transferFrom([zeroAddress, other.account.address, 0n], { account: other.account })).to.be.rejectedWith("InvalidAmount");
    await expect(vault.write.transferFrom([creator.account.address, other.account.address, 1n], { account: other.account })).to.be.rejectedWith("InsufficientAllowance");
    await tokens[1].write.approve([vault.address, 0n], { account: other.account });
    await expect(vault.write.create([SHARE, (await vault.read.amountsFor([SHARE]))[1]], { account: other.account })).to.be.rejectedWith("TransferFailed");
  });

  it("refuses a token that delivers less than owed, even when a donation leaves a surplus", async () => {
    const { creator, tokens } = await deploy();
    const taxed = await hre.viem.deployContract("FeeOnTransferToken", [creator.account.address, 10n ** 24n]);
    const vault = await hre.viem.deployContract("GanymedeBasketVault", ["Taxed", "TAX", [tokens[0].address, taxed.address], [SHARE, 10n ** 18n]]);
    await tokens[0].write.approve([vault.address, maxUint256], { account: creator.account });
    await taxed.write.approve([vault.address, maxUint256], { account: creator.account });
    await taxed.write.transfer([vault.address, 10n ** 20n], { account: creator.account });
    await expect(vault.write.create([SHARE, (await vault.read.amountsFor([SHARE]))[1]], { account: creator.account })).to.be.rejectedWith("TransferFailed");
  });
});
