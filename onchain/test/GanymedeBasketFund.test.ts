import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, parseEventLogs, type Hash } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";

const USTX = productKey("us-tech-x");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const USD = 1_000_000n;
const NAV = 99_449_929n; // $99.449929 per share

async function deploy() {
  const [admin, relayer, alice, bob, carol] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address], { client: { wallet: admin } });
  const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address], { client: { wallet: admin } });
  const fund = await hre.viem.deployContract(
    "GanymedeBasketFund",
    ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address],
    { client: { wallet: admin } },
  );
  await dollar.write.setMinter([fund.address], { account: admin.account });

  // Each record needs a later effective time than the last, as the registry requires.
  async function publish(nav: bigint) {
    await time.increase(60);
    await registry.write.publishNav([USTX, nav, 0n, HOLDINGS, BigInt(await time.latest())], { account: relayer.account });
  }
  async function fundWallet(wallet: typeof alice, approve = 10_000n * USD) {
    await dollar.write.claim({ account: wallet.account });
    await dollar.write.approve([fund.address, approve], { account: wallet.account });
  }
  async function logs(hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return parseEventLogs({ abi: fund.abi, logs: receipt.logs });
  }
  return { registry, dollar, fund, admin, relayer, alice, bob, carol, publish, fundWallet, logs };
}

describe("GanymedeDemoDollar", () => {
  it("gives anyone 10,000 demo dollars once a day", async () => {
    const { dollar, alice } = await deploy();
    expect(await dollar.read.symbol()).to.equal("dUSD");
    expect(await dollar.read.decimals()).to.equal(6);
    expect(await dollar.read.nextClaimAt([alice.account.address])).to.equal(0n);

    await dollar.write.claim({ account: alice.account });
    expect(await dollar.read.balanceOf([alice.account.address])).to.equal(10_000n * USD);
    const next = await dollar.read.nextClaimAt([alice.account.address]);
    expect(next).to.equal(BigInt(await time.latest()) + 86_400n);
    await expect(dollar.write.claim({ account: alice.account })).to.be.rejectedWith("ClaimTooSoon");

    await time.increaseTo(next);
    await dollar.write.claim({ account: alice.account });
    expect(await dollar.read.balanceOf([alice.account.address])).to.equal(20_000n * USD);
  });

  it("lets only the fund mint and only the administrator choose the fund", async () => {
    const { dollar, fund, alice } = await deploy();
    expect(getAddress(await dollar.read.minter())).to.equal(getAddress(fund.address));
    await expect(dollar.write.mint([alice.account.address, USD], { account: alice.account })).to.be.rejectedWith("Unauthorized");
    await expect(dollar.write.setMinter([alice.account.address], { account: alice.account })).to.be.rejectedWith("Unauthorized");
  });
});

describe("GanymedeBasketFund", () => {
  it("prices the fund from the USTX record in the registry", async () => {
    const { fund, registry, dollar } = await deploy();
    // keccak256("us-tech-x"), the key the app publishes USTX under.
    expect(USTX).to.equal("0x7fd4bda948705c478ec63926a4cdececd33422c85c3e35f414251992b48c2a20");
    expect(await fund.read.productId()).to.equal(USTX);
    expect(getAddress(await fund.read.registry())).to.equal(getAddress(registry.address));
    expect(getAddress(await fund.read.dollar())).to.equal(getAddress(dollar.address));
    expect(await fund.read.symbol()).to.equal("USTX");
    expect(await fund.read.decimals()).to.equal(6);
  });

  it("issues shares at the recorded NAV and burns the dollars invested", async () => {
    const { fund, dollar, alice, publish, fundWallet, logs } = await deploy();
    await publish(NAV);
    await fundWallet(alice);
    const expected = (1_000n * USD * 1_000_000n) / NAV; // 10.055311 USTX
    expect(await fund.read.previewInvest([1_000n * USD])).to.equal(expected);

    const events = await logs(await fund.write.invest([1_000n * USD, expected], { account: alice.account }));
    const invested = events.find(event => event.eventName === "Invested");
    expect(invested?.args).to.deep.include({ dollars: 1_000n * USD, shares: expected, navPerShareMicros: NAV });

    expect(await fund.read.balanceOf([alice.account.address])).to.equal(expected);
    expect(await fund.read.totalSupply()).to.equal(expected);
    expect(await fund.read.investorCount()).to.equal(1n);
    expect(await dollar.read.balanceOf([alice.account.address])).to.equal(9_000n * USD);
    expect(await dollar.read.balanceOf([fund.address])).to.equal(0n);
    expect(await dollar.read.totalSupply()).to.equal(9_000n * USD);
  });

  it("redeems at the latest NAV, paying newly minted dollars", async () => {
    const { fund, dollar, alice, publish, fundWallet, logs } = await deploy();
    await publish(NAV);
    await fundWallet(alice);
    await fund.write.invest([1_000n * USD, 0n], { account: alice.account });
    const shares = await fund.read.balanceOf([alice.account.address]);

    const higher = (NAV * 11n) / 10n;
    await publish(higher);
    const payout = (shares * higher) / 1_000_000n;
    expect(await fund.read.previewRedeem([shares])).to.equal(payout);

    const events = await logs(await fund.write.redeem([shares, payout], { account: alice.account }));
    expect(events.find(event => event.eventName === "Redeemed")?.args).to.deep.include({ shares, dollars: payout, navPerShareMicros: higher });
    expect(payout > 1_000n * USD).to.equal(true);
    expect(await dollar.read.balanceOf([alice.account.address])).to.equal(9_000n * USD + payout);
    expect(await fund.read.totalSupply()).to.equal(0n);
    expect(await fund.read.investorCount()).to.equal(0n);
  });

  it("rounds down both ways, so a round trip never pays out more", async () => {
    const { fund, dollar, alice, publish, fundWallet } = await deploy();
    await publish(3n * USD);
    await fundWallet(alice);
    await fund.write.invest([10n * USD, 0n], { account: alice.account });
    expect(await fund.read.balanceOf([alice.account.address])).to.equal(3_333_333n);
    await fund.write.redeem([3_333_333n, 0n], { account: alice.account });
    expect(await dollar.read.balanceOf([alice.account.address])).to.equal(9_990n * USD + 9_999_999n);
  });

  it("refuses orders with no record, a record over an hour old or below $10", async () => {
    const { fund, alice, publish, fundWallet } = await deploy();
    await fundWallet(alice);
    await expect(fund.write.invest([10n * USD, 0n], { account: alice.account })).to.be.rejectedWith("NavUnavailable");

    await publish(NAV);
    await expect(fund.write.invest([10n * USD - 1n, 0n], { account: alice.account })).to.be.rejectedWith("BelowMinimum");
    await fund.write.invest([10n * USD, 0n], { account: alice.account });

    await time.increase(3_601);
    await expect(fund.write.invest([10n * USD, 0n], { account: alice.account })).to.be.rejectedWith("NavTooOld");
    await expect(fund.write.redeem([1n, 0n], { account: alice.account })).to.be.rejectedWith("NavTooOld");
    await expect(fund.read.previewInvest([10n * USD])).to.be.rejectedWith("NavTooOld");

    await publish(NAV);
    await expect(fund.write.redeem([0n, 0n], { account: alice.account })).to.be.rejectedWith("InvalidAmount");
  });

  it("reverts when the price moved past the investor's limit", async () => {
    const { fund, alice, publish, fundWallet } = await deploy();
    await publish(NAV);
    await fundWallet(alice);
    const expected = await fund.read.previewInvest([1_000n * USD]);
    await expect(fund.write.invest([1_000n * USD, expected + 1n], { account: alice.account })).to.be.rejectedWith("SlippageExceeded");
    await fund.write.invest([1_000n * USD, expected], { account: alice.account });
    const payout = await fund.read.previewRedeem([expected]);
    await expect(fund.write.redeem([expected, payout + 1n], { account: alice.account })).to.be.rejectedWith("SlippageExceeded");
  });

  it("needs an approval and a balance to invest", async () => {
    const { fund, dollar, alice, bob, publish } = await deploy();
    await publish(NAV);
    await dollar.write.claim({ account: alice.account });
    await expect(fund.write.invest([100n * USD, 0n], { account: alice.account })).to.be.rejectedWith("InsufficientAllowance");
    await dollar.write.approve([fund.address, 100n * USD], { account: bob.account });
    await expect(fund.write.invest([100n * USD, 0n], { account: bob.account })).to.be.rejectedWith("InsufficientBalance");
  });

  it("counts investors as balances cross zero, including transfers", async () => {
    const { fund, alice, bob, carol, publish, fundWallet } = await deploy();
    await publish(NAV);
    await fundWallet(alice);
    await fundWallet(bob);
    await fund.write.invest([100n * USD, 0n], { account: alice.account });
    await fund.write.invest([100n * USD, 0n], { account: bob.account });
    expect(await fund.read.investorCount()).to.equal(2n);

    const aliceShares = await fund.read.balanceOf([alice.account.address]);
    await fund.write.transfer([alice.account.address, aliceShares], { account: alice.account });
    await fund.write.transfer([carol.account.address, 0n], { account: alice.account });
    expect(await fund.read.investorCount()).to.equal(2n);

    await fund.write.transfer([bob.account.address, aliceShares], { account: alice.account });
    expect(await fund.read.investorCount()).to.equal(1n);
    await fund.write.transfer([carol.account.address, 1n], { account: bob.account });
    expect(await fund.read.investorCount()).to.equal(2n);
    await expect(fund.write.transfer([carol.account.address, aliceShares * 3n], { account: bob.account })).to.be.rejectedWith("InsufficientBalance");
  });

  it("lets only the administrator pause, and a pause stops orders and transfers", async () => {
    const { fund, admin, alice, bob, publish, fundWallet } = await deploy();
    await publish(NAV);
    await fundWallet(alice);
    await fund.write.invest([100n * USD, 0n], { account: alice.account });

    await expect(fund.write.pause({ account: alice.account })).to.be.rejectedWith("Unauthorized");
    await fund.write.pause({ account: admin.account });
    await expect(fund.write.invest([100n * USD, 0n], { account: alice.account })).to.be.rejectedWith("ContractPaused");
    await expect(fund.write.redeem([1n, 0n], { account: alice.account })).to.be.rejectedWith("ContractPaused");
    await expect(fund.write.transfer([bob.account.address, 1n], { account: alice.account })).to.be.rejectedWith("ContractPaused");

    await fund.write.unpause({ account: admin.account });
    await fund.write.redeem([1_000_000n, 0n], { account: alice.account });
  });

  it("hands administration over in two steps on both contracts", async () => {
    const { fund, dollar, admin, alice, bob } = await deploy();
    await expect(fund.write.proposeAdministrator([bob.account.address], { account: alice.account })).to.be.rejectedWith("Unauthorized");
    await fund.write.proposeAdministrator([bob.account.address], { account: admin.account });
    await expect(fund.write.acceptAdministrator({ account: alice.account })).to.be.rejectedWith("Unauthorized");
    await fund.write.acceptAdministrator({ account: bob.account });
    expect(getAddress(await fund.read.administrator())).to.equal(getAddress(bob.account.address));

    await expect(dollar.write.proposeAdministrator([bob.account.address], { account: alice.account })).to.be.rejectedWith("Unauthorized");
    await dollar.write.proposeAdministrator([bob.account.address], { account: admin.account });
    await expect(dollar.write.acceptAdministrator({ account: alice.account })).to.be.rejectedWith("Unauthorized");
    await dollar.write.acceptAdministrator({ account: bob.account });
    expect(getAddress(await dollar.read.administrator())).to.equal(getAddress(bob.account.address));
  });
});
