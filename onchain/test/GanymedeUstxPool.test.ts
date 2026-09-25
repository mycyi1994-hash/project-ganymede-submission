import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, maxUint256, parseEventLogs, zeroAddress, type Hash } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";

const USTX = productKey("us-tech-x");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const USD = 1_000_000n;
const SHARE = 1_000_000n;
const NAV = 100n * USD; // $100 per USTX keeps the arithmetic readable

// The pool's constant-product output with the 0.3% fee, as Uniswap V2 computes it.
const amountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint) => (amountIn * 9_970n * reserveOut) / (reserveIn * 10_000n + amountIn * 9_970n);

async function deploy() {
  const [admin, relayer, provider, trader, arbitrageur, other] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address], { client: { wallet: admin } });
  const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address], { client: { wallet: admin } });
  const fund = await hre.viem.deployContract(
    "GanymedeBasketFund",
    ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address],
    { client: { wallet: admin } },
  );
  await dollar.write.setMinter([fund.address], { account: admin.account });
  const pool = await hre.viem.deployContract("GanymedeUstxPool", [fund.address], { client: { wallet: admin } });
  const arbitrage = await hre.viem.deployContract("GanymedeNavArbitrage", [pool.address], { client: { wallet: admin } });

  async function publish(nav: bigint) {
    await time.increase(60);
    await registry.write.publishNav([USTX, nav, 0n, HOLDINGS, BigInt(await time.latest())], { account: relayer.account });
  }
  // Claims 10,000 demo dollars and approves the fund, the pool and the arbitrage contract.
  async function prepare(wallet: typeof admin) {
    await dollar.write.claim({ account: wallet.account });
    for (const spender of [fund.address, pool.address, arbitrage.address]) {
      await dollar.write.approve([spender, maxUint256], { account: wallet.account });
    }
    await fund.write.approve([pool.address, maxUint256], { account: wallet.account });
  }
  // Buys USTX at the NAV with `dollars` and adds it with the same value in demo dollars.
  async function seed(wallet: typeof admin, dollars: bigint) {
    await fund.write.invest([dollars, 0n], { account: wallet.account });
    const shares = await fund.read.balanceOf([wallet.account.address]);
    const [nav] = await fund.read.currentNav();
    await pool.write.addLiquidity([shares, (shares * nav) / SHARE, 0n, 0n, maxUint256], { account: wallet.account });
    return shares;
  }
  async function events(hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return parseEventLogs({ abi: [...pool.abi, ...arbitrage.abi], logs: receipt.logs });
  }
  return { registry, dollar, fund, pool, arbitrage, admin, provider, trader, arbitrageur, other, publish, prepare, seed, events };
}

describe("GanymedeUstxPool", () => {
  it("pairs USTX with the fund's demo dollar and locks the first liquidity", async () => {
    const { pool, fund, dollar, provider, publish, prepare, seed } = await deploy();
    expect(await pool.read.symbol()).to.equal("USTX-LP");
    expect(await pool.read.decimals()).to.equal(6);
    expect(getAddress(await pool.read.fund())).to.equal(getAddress(fund.address));
    expect(getAddress(await pool.read.dollar())).to.equal(getAddress(dollar.address));
    expect(await pool.read.price()).to.equal(0n);

    await publish(NAV);
    await prepare(provider);
    expect(await seed(provider, 5_000n * USD)).to.equal(50n * SHARE);
    // sqrt(50 USTX × $5,000) in micros, less the 1,000 locked for good.
    expect(await pool.read.totalSupply()).to.equal(500_000_000n);
    expect(await pool.read.balanceOf([provider.account.address])).to.equal(500_000_000n - 1_000n);
    expect(await pool.read.balanceOf([zeroAddress])).to.equal(1_000n);
    expect(await pool.read.getReserves()).to.deep.equal([50n * SHARE, 5_000n * USD]);
    expect(await pool.read.price()).to.equal(NAV);
    expect(await pool.read.premiumBps()).to.equal(0n);
  });

  it("adds liquidity at the pool's ratio and removes it pro rata", async () => {
    const { pool, fund, dollar, provider, other, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(other);
    await seed(provider, 5_000n * USD);

    await fund.write.invest([1_000n * USD, 0n], { account: other.account });
    // Offering $2,000 with 10 USTX takes only the $1,000 that matches the pool's price.
    await expect(pool.write.addLiquidity([10n * SHARE, 2_000n * USD, 0n, 1_001n * USD, maxUint256], { account: other.account })).to.be.rejectedWith("SlippageExceeded");
    await pool.write.addLiquidity([10n * SHARE, 2_000n * USD, 0n, 0n, maxUint256], { account: other.account });
    expect(await pool.read.balanceOf([other.account.address])).to.equal(100_000_000n);
    expect(await pool.read.getReserves()).to.deep.equal([60n * SHARE, 6_000n * USD]);
    expect(await dollar.read.balanceOf([other.account.address])).to.equal(8_000n * USD);

    await pool.write.removeLiquidity([50_000_000n, 0n, 0n, maxUint256], { account: other.account });
    expect(await fund.read.balanceOf([other.account.address])).to.equal(5n * SHARE);
    expect(await dollar.read.balanceOf([other.account.address])).to.equal(8_500n * USD);
    await expect(pool.write.removeLiquidity([50_000_001n, 0n, 0n, maxUint256], { account: other.account })).to.be.rejectedWith("InsufficientBalance");

    // Offering fewer dollars than the USTX needs takes only the USTX those dollars match.
    await pool.write.addLiquidity([5n * SHARE, 200n * USD, 0n, 0n, maxUint256], { account: other.account });
    expect(await fund.read.balanceOf([other.account.address])).to.equal(3n * SHARE);
    expect(await dollar.read.balanceOf([other.account.address])).to.equal(8_300n * USD);
  });

  it("trades at constant product with a 0.3% fee that stays with liquidity providers", async () => {
    const { pool, fund, dollar, provider, trader, publish, prepare, seed, events } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(trader);
    await seed(provider, 5_000n * USD);

    const expected = amountOut(1_000n * USD, 5_000n * USD, 50n * SHARE);
    expect(await pool.read.quoteBuy([1_000n * USD])).to.equal(expected);
    const bought = await events(await pool.write.buy([1_000n * USD, expected, maxUint256], { account: trader.account }));
    expect(bought.find(event => event.eventName === "Bought")?.args).to.deep.include({ dollarsIn: 1_000n * USD, sharesOut: expected });
    expect(await fund.read.balanceOf([trader.account.address])).to.equal(expected);

    const back = await pool.read.quoteSell([expected]);
    await pool.write.sell([expected, back, maxUint256], { account: trader.account });
    // A round trip costs the trader about 0.6%; the pool keeps it.
    expect(await dollar.read.balanceOf([trader.account.address])).to.equal(9_000n * USD + back);
    expect(back < 1_000n * USD && back > 993n * USD).to.equal(true);
    const [shares, dollars] = await pool.read.getReserves();
    expect(shares).to.equal(50n * SHARE);
    expect(dollars).to.equal(5_000n * USD + 1_000n * USD - back);
  });

  it("protects traders with a minimum output and a deadline", async () => {
    const { pool, trader, publish, prepare, seed } = await deploy();
    await expect(pool.read.quoteBuy([USD])).to.be.rejectedWith("InsufficientLiquidity");
    await publish(NAV);
    await prepare(trader);
    await seed(trader, 1_000n * USD);
    const out = await pool.read.quoteBuy([100n * USD]);
    await expect(pool.write.buy([100n * USD, out + 1n, maxUint256], { account: trader.account })).to.be.rejectedWith("SlippageExceeded");
    await expect(pool.write.buy([100n * USD, 0n, BigInt(await time.latest()) - 1n], { account: trader.account })).to.be.rejectedWith("Expired");
    await expect(pool.write.buy([0n, 0n, maxUint256], { account: trader.account })).to.be.rejectedWith("InvalidAmount");
    await expect(pool.write.sell([SHARE, maxUint256, maxUint256], { account: trader.account })).to.be.rejectedWith("SlippageExceeded");
  });

  it("prices the pool against the fund's NAV", async () => {
    const { pool, trader, provider, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(trader);
    await seed(provider, 5_000n * USD);
    await pool.write.buy([500n * USD, 0n, maxUint256], { account: trader.account });
    const premium = await pool.read.premiumBps();
    expect(premium > 1_900n && premium < 2_200n).to.equal(true); // about 21% above a $100 NAV
    await publish(125n * USD);
    expect((await pool.read.premiumBps()) < 0n).to.equal(true);
    await time.increase(3_601);
    await expect(pool.read.premiumBps()).to.be.rejectedWith("NavTooOld");
  });

  it("moves LP tokens like an ERC-20", async () => {
    const { pool, provider, other, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await seed(provider, 1_000n * USD);
    await pool.write.transfer([other.account.address, 1_000n], { account: provider.account });
    expect(await pool.read.balanceOf([other.account.address])).to.equal(1_000n);
    await expect(pool.write.transferFrom([provider.account.address, other.account.address, 1n], { account: other.account })).to.be.rejectedWith("InsufficientAllowance");
    await pool.write.approve([other.account.address, 500n], { account: provider.account });
    await pool.write.transferFrom([provider.account.address, other.account.address, 500n], { account: other.account });
    expect(await pool.read.allowance([provider.account.address, other.account.address])).to.equal(0n);
    expect(await pool.read.balanceOf([other.account.address])).to.equal(1_500n);
  });
});

describe("GanymedeNavArbitrage", () => {
  it("buys below the NAV in the pool and redeems at the fund in one transaction", async () => {
    const { pool, fund, dollar, arbitrage, provider, trader, arbitrageur, publish, prepare, seed, events } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(trader);
    await prepare(arbitrageur);
    await seed(provider, 5_000n * USD);
    // A seller pushes the pool about 4% below the NAV.
    await fund.write.invest([100n * USD, 0n], { account: trader.account });
    await pool.write.sell([SHARE, 0n, maxUint256], { account: trader.account });
    expect((await pool.read.premiumBps()) < -300n).to.equal(true);

    const [buyInPool, dollarsIn, dollarsOut] = await arbitrage.read.quote();
    expect(buyInPool).to.equal(true);
    expect(dollarsOut > dollarsIn && dollarsIn > 0n).to.equal(true);
    // The quoted size earns more than 10% less or 10% more would.
    const profitAt = async (size: bigint) => ((await pool.read.quoteBuy([size])) * NAV) / SHARE - size;
    expect(dollarsOut - dollarsIn >= (await profitAt((dollarsIn * 9n) / 10n))).to.equal(true);
    expect(dollarsOut - dollarsIn >= (await profitAt((dollarsIn * 11n) / 10n))).to.equal(true);
    const before = await dollar.read.balanceOf([arbitrageur.account.address]);
    const logs = await events(await arbitrage.write.buyAndRedeem([dollarsIn, dollarsOut - dollarsIn], { account: arbitrageur.account }));
    expect(logs.find(event => event.eventName === "Arbitraged")?.args).to.deep.include({ boughtInPool: true, dollarsIn, dollarsOut, navPerShareMicros: NAV });
    expect(await dollar.read.balanceOf([arbitrageur.account.address])).to.equal(before - dollarsIn + dollarsOut);
    // The pool is back within the fee of the NAV, and the contract kept nothing.
    const premium = await pool.read.premiumBps();
    expect(premium >= -31n && premium <= 0n).to.equal(true);
    expect(await dollar.read.balanceOf([arbitrage.address])).to.equal(0n);
    expect(await fund.read.balanceOf([arbitrage.address])).to.equal(0n);
    expect((await arbitrage.read.quote())[1]).to.equal(0n);
  });

  it("invests at the fund and sells above the NAV in one transaction", async () => {
    const { pool, fund, dollar, arbitrage, provider, trader, arbitrageur, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(trader);
    await prepare(arbitrageur);
    await seed(provider, 5_000n * USD);
    // A buyer pushes the pool above the NAV.
    await pool.write.buy([300n * USD, 0n, maxUint256], { account: trader.account });
    expect((await pool.read.premiumBps()) > 1_000n).to.equal(true);

    const [buyInPool, dollarsIn, dollarsOut] = await arbitrage.read.quote();
    expect(buyInPool).to.equal(false);
    expect(dollarsOut > dollarsIn && dollarsIn >= 10n * USD).to.equal(true);
    const profitAt = async (size: bigint) => (await pool.read.quoteSell([(size * SHARE) / NAV])) - size;
    expect(dollarsOut - dollarsIn >= (await profitAt((dollarsIn * 9n) / 10n))).to.equal(true);
    expect(dollarsOut - dollarsIn >= (await profitAt((dollarsIn * 11n) / 10n))).to.equal(true);
    const before = await dollar.read.balanceOf([arbitrageur.account.address]);
    await arbitrage.write.investAndSell([dollarsIn, 0n], { account: arbitrageur.account });
    expect(await dollar.read.balanceOf([arbitrageur.account.address])).to.equal(before - dollarsIn + dollarsOut);
    const premium = await pool.read.premiumBps();
    expect(premium >= 0n && premium <= 31n).to.equal(true);
    expect(await fund.read.balanceOf([arbitrage.address])).to.equal(0n);
  });

  it("refuses a round trip that would lose money", async () => {
    const { arbitrage, provider, arbitrageur, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(arbitrageur);
    await seed(provider, 5_000n * USD);
    // At the NAV there is no gap: the fee makes both directions lose.
    expect((await arbitrage.read.quote())[1]).to.equal(0n);
    await expect(arbitrage.write.buyAndRedeem([100n * USD, 0n], { account: arbitrageur.account })).to.be.rejectedWith("Unprofitable");
    await expect(arbitrage.write.investAndSell([100n * USD, 0n], { account: arbitrageur.account })).to.be.rejectedWith("Unprofitable");
  });

  it("needs a fresh NAV", async () => {
    const { pool, fund, arbitrage, provider, trader, arbitrageur, publish, prepare, seed } = await deploy();
    await publish(NAV);
    await prepare(provider);
    await prepare(trader);
    await prepare(arbitrageur);
    await seed(provider, 5_000n * USD);
    await fund.write.invest([100n * USD, 0n], { account: trader.account });
    await pool.write.sell([SHARE, 0n, maxUint256], { account: trader.account });
    await time.increase(3_601);
    await expect(arbitrage.read.quote()).to.be.rejectedWith("NavTooOld");
    await expect(arbitrage.write.buyAndRedeem([50n * USD, 0n], { account: arbitrageur.account })).to.be.rejectedWith("NavTooOld");
  });
});
