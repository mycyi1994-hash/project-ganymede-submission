import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, getContract, maxUint256, parseEventLogs, toFunctionSelector, type Hex } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";
import {
  ALL_HOOK_MASK,
  CREATE2_PROXY,
  CREATE2_PROXY_CODE,
  DYNAMIC_FEE_FLAG,
  RWA_HOOK_FLAGS,
  deployRangeLiquidity,
  deployRwaLiquidity,
  modifyLiquidityTestArtifact,
  navSqrtPriceX96,
  poolIdOf,
  readSlot0,
  type PoolKey,
} from "../scripts/_v4";

const USTX = productKey("us-tech-x");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const USD = 1_000_000n;
const SHARE = 1_000_000n;
const NAV = 100n * USD;
const HOUR = 3_600n;
const SPOT = 0, CURVE = 1, BID_ASK = 2;

const selector = (signature: string) => toFunctionSelector(signature).slice(2);

function revertText(error: unknown): string {
  const parts: string[] = [];
  let current = error as Record<string, unknown> | undefined;
  for (let depth = 0; current && depth < 10; depth++) {
    for (const key of ["details", "raw", "signature", "reason"]) if (typeof current[key] === "string") parts.push(current[key] as string);
    const data = current.data as Record<string, unknown> | string | undefined;
    if (typeof data === "string") parts.push(data);
    else if (data && typeof data.errorName === "string") parts.push(data.errorName);
    current = current.cause as Record<string, unknown> | undefined;
  }
  return parts.join(" ");
}

async function expectRevert(promise: Promise<unknown>, error: string) {
  try {
    await promise;
  } catch (caught) {
    const text = revertText(caught);
    const name = error.replace(/\(.*$/, "");
    const signature = error.includes("(") ? error : `${error}()`;
    if (new RegExp(`\\b${name}\\b`).test(text) || text.toLowerCase().includes(selector(signature))) return;
    throw new Error(`expected ${error}, got: ${text.slice(0, 400) || String(caught).slice(0, 400)}`);
  }
  throw new Error(`expected ${error}, but the call succeeded`);
}

async function deadline() {
  return BigInt(await time.latest()) + 3n * HOUR;
}

async function deploy() {
  const [admin, relayer, lp, lp2, trader, keeper] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
  const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
  const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
  await dollar.write.setMinter([fund.address], { account: admin.account });
  const feed = await hre.viem.deployContract("GanymedeNavFeed", [registry.address, USTX, "USTX / USD"]);
  async function publish(nav: bigint) {
    await time.increase(60);
    await registry.write.publishNav([USTX, nav, 0n, HOLDINGS, BigInt(await time.latest())], { account: relayer.account });
  }
  await publish(NAV);

  await hre.network.provider.request({ method: "hardhat_setCode", params: [CREATE2_PROXY, CREATE2_PROXY_CODE] });
  const read = async (name: string) => { const artifact = await hre.artifacts.readArtifact(name); return { abi: artifact.abi, bytecode: artifact.bytecode as Hex }; };
  // The pool manager and router, as on X Layer Testnet; the range hook joins the same pool manager.
  const base = await deployRwaLiquidity({
    wallet: admin, publicClient, hookArtifact: await read("GanymedeRwaLiquidityHook"), routerArtifact: await read("GanymedeV4Router"),
    asset: fund.address, dollar: dollar.address, feed: feed.address, name: "Ganymede USTX-dUSD v4 LP", symbol: "USTX-V4LP",
  });
  const range = await deployRangeLiquidity({
    wallet: admin, publicClient, hookArtifact: await read("GanymedeRangeLiquidityHook"), arbitrageArtifact: await read("GanymedeRangeArbitrage"),
    poolManager: base.poolManager.address, asset: fund.address, dollar: dollar.address, feed: feed.address,
  });
  const hook = await hre.viem.getContractAt("GanymedeRangeLiquidityHook", range.hook.address);
  const arbitrage = await hre.viem.getContractAt("GanymedeRangeArbitrage", range.arbitrage.address);
  const router = await hre.viem.getContractAt("GanymedeV4Router", base.router.address);
  const assetIsCurrency0 = BigInt(fund.address) < BigInt(dollar.address);
  const key: PoolKey = {
    currency0: getAddress(assetIsCurrency0 ? fund.address : dollar.address),
    currency1: getAddress(assetIsCurrency0 ? dollar.address : fund.address),
    fee: DYNAMIC_FEE_FLAG, tickSpacing: 10, hooks: getAddress(hook.address),
  };
  const poolId = poolIdOf(key);
  const managerAddress = base.poolManager.address;
  /** Amounts in pool order from USTX and demo dollars. */
  const pair = (ustx: bigint, dollars: bigint): [bigint, bigint] => (assetIsCurrency0 ? [ustx, dollars] : [dollars, ustx]);

  async function prepare(wallet: typeof admin, invest = 0n) {
    await dollar.write.claim({ account: wallet.account });
    for (const spender of [fund.address, hook.address, router.address]) await dollar.write.approve([spender, maxUint256], { account: wallet.account });
    for (const spender of [hook.address, router.address]) await fund.write.approve([spender, maxUint256], { account: wallet.account });
    if (invest > 0n) await fund.write.invest([invest, 0n], { account: wallet.account });
  }
  /** Opens a position with `ustx` above the price and `dollars` below it. */
  async function open(wallet: typeof admin, shape: number, binTicks: number, below: number, above: number, ustx: bigint, dollars: bigint) {
    // Bins below the price hold currency1, above it currency0: with USTX as currency0 that is dUSD below.
    const [amount0, amount1] = assetIsCurrency0 ? [ustx, dollars] : [dollars, ustx];
    const hash = await hook.write.open([shape, binTicks, below, above, amount0, amount1, await deadline()], { account: wallet.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const opened = parseEventLogs({ abi: hook.abi, logs: receipt.logs, eventName: "PositionOpened" })[0];
    return { id: opened.args.id, used0: opened.args.amount0, used1: opened.args.amount1, receipt };
  }
  const buyUstx = !assetIsCurrency0;
  const sellUstx = assetIsCurrency0;
  const slot0 = () => readSlot0(publicClient, managerAddress, poolId);
  const poolNav = async () => {
    const { sqrtPriceX96 } = await slot0();
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    return assetIsCurrency0 ? (priceX192 * SHARE) / (1n << 192n) : ((1n << 192n) * SHARE) / priceX192;
  };
  return { managerAddress, admin, relayer, lp, lp2, trader, keeper, publicClient, registry, dollar, fund, feed, hook, arbitrage, router, key, poolId, assetIsCurrency0, pair, prepare, open, publish, buyUstx, sellUstx, slot0, poolNav };
}

describe("GanymedeRangeLiquidityHook", () => {
  it("opens its own pool at the NAV and carries its permissions in its address", async () => {
    const { hook, key, slot0, assetIsCurrency0 } = await deploy();
    expect(BigInt(hook.address) & ALL_HOOK_MASK).to.equal(RWA_HOOK_FLAGS);
    expect(await hook.read.poolKey()).to.deep.equal(key);
    expect((await slot0()).sqrtPriceX96).to.equal(navSqrtPriceX96(NAV * 100n, 8, 6, 6, assetIsCurrency0));
  });

  it("spreads each side by its shape: even for Spot, heaviest near the price for Curve, at the ends for Bid-Ask", async () => {
    const { hook, lp, prepare, open, assetIsCurrency0 } = await deploy();
    await prepare(lp, 3_000n * USD);
    const ustxBalance = 30n * SHARE;
    for (const shape of [SPOT, CURVE, BID_ASK]) {
      const { id, used0, used1 } = await open(lp, shape, 50, 5, 5, ustxBalance / 4n, 1_000n * USD);
      const [usedUstx, usedDollars] = assetIsCurrency0 ? [used0, used1] : [used1, used0];
      // Takes at most what was given, and all but rounding.
      expect(usedUstx <= ustxBalance / 4n && usedUstx > ustxBalance / 4n - 20n).to.equal(true);
      expect(usedDollars <= 1_000n * USD && usedDollars > 1_000n * USD - 20n).to.equal(true);
      const [lowers, uppers, liquidity] = await hook.read.binsOf([id]);
      expect(lowers.length).to.equal(10);
      // Every bin is 50 ticks wide and the run skips only the interval the price is in.
      for (let index = 0; index < 10; index++) expect(uppers[index] - lowers[index]).to.equal(50);
      expect(lowers[5] - uppers[4]).to.equal(10);
      // Liquidity per bin follows the weights; tokens per bin follow them too, give or take the bins' prices.
      const below = liquidity.slice(0, 5), above = liquidity.slice(5);
      if (shape === SPOT) {
        expect(Number(below[0]) / Number(below[4])).to.be.closeTo(1, 0.03);
        expect(Number(above[0]) / Number(above[4])).to.be.closeTo(1, 0.03);
      } else if (shape === CURVE) {
        // The bin next to the price (last below, first above) holds five times the farthest.
        expect(Number(below[4]) / Number(below[0])).to.be.closeTo(5, 0.2);
        expect(Number(above[0]) / Number(above[4])).to.be.closeTo(5, 0.2);
      } else {
        expect(Number(below[0]) / Number(below[4])).to.be.closeTo(5, 0.2);
        expect(Number(above[4]) / Number(above[0])).to.be.closeTo(5, 0.2);
      }
      const position = await hook.read.positions([id]);
      expect(getAddress(position[0])).to.equal(getAddress(lp.account.address));
      expect(position[1]).to.equal(shape);
      expect(position[6]).to.equal(true);
    }
    expect((await hook.read.positionsOf([lp.account.address])).length).to.equal(3);
  });

  it("earns fees on the bins trades cross and pays them with the tokens to the owner only", async () => {
    const { hook, router, key, lp, lp2, trader, prepare, open, dollar, fund, buyUstx, sellUstx } = await deploy();
    await prepare(lp, 3_000n * USD);
    await prepare(lp2);
    await prepare(trader, 1_000n * USD);
    const { id } = await open(lp, BID_ASK, 20, 10, 10, 20n * SHARE, 2_000n * USD);
    await expectRevert(hook.write.close([id, 0n, 0n, await deadline()], { account: lp2.account }), "NotOwner");
    // A trader buys and sells back: the position ends with fees in both tokens.
    const dollarsBefore = await dollar.read.balanceOf([trader.account.address]);
    await router.write.swapExactInput([key, buyUstx, 300n * USD, 0n, await deadline()], { account: trader.account });
    const bought = (await fund.read.balanceOf([trader.account.address])) - 10n * SHARE;
    await router.write.swapExactInput([key, sellUstx, bought, 0n, await deadline()], { account: trader.account });
    expect(await dollar.read.balanceOf([trader.account.address]) < dollarsBefore).to.equal(true);
    const [amount0, amount1, fees0, fees1] = await hook.read.positionAmounts([id]);
    expect(fees0 > 0n && fees1 > 0n).to.equal(true);
    const before = { dollars: await dollar.read.balanceOf([lp.account.address]), ustx: await fund.read.balanceOf([lp.account.address]) };
    await hook.write.close([id, 0n, 0n, await deadline()], { account: lp.account });
    const gained0 = (await fund.read.balanceOf([lp.account.address])) - before.ustx;
    const gained1 = (await dollar.read.balanceOf([lp.account.address])) - before.dollars;
    const [expectUstx, expectDollars] = (await hook.read.assetIsCurrency0()) ? [amount0, amount1] : [amount1, amount0];
    expect(gained0 >= expectUstx - 2n && gained0 <= expectUstx + 2n).to.equal(true);
    expect(gained1 >= expectDollars - 2n && gained1 <= expectDollars + 2n).to.equal(true);
    await expectRevert(hook.write.close([id, 0n, 0n, await deadline()], { account: lp.account }), "PositionClosedAlready");
    expect((await hook.read.positionAmounts([id]))[0]).to.equal(0n);
  });

  it("refuses liquidity outside its own, positions away from the NAV, bad shapes, and swaps on a stale NAV or out of the band", async () => {
    const { hook, router, key, lp, trader, prepare, open, publish, buyUstx, managerAddress, publicClient } = await deploy();
    const helper = modifyLiquidityTestArtifact();
    const helperHash = await trader.deployContract({ abi: helper.abi, bytecode: helper.bytecode, args: [managerAddress] });
    const outsider = getContract({ address: (await publicClient.waitForTransactionReceipt({ hash: helperHash })).contractAddress!, abi: helper.abi, client: { public: publicClient, wallet: trader } });
    await expectRevert(outsider.write.modifyLiquidity([key, { tickLower: 45_000, tickUpper: 47_000, liquidityDelta: 10n ** 9n, salt: `0x${"00".repeat(32)}` as Hex }, "0x"]), "LiquidityThroughHook");
    await prepare(lp, 3_000n * USD);
    await prepare(trader, 0n);
    await expectRevert(hook.write.open([SPOT, 15, 2, 2, 1n * SHARE, 100n * USD, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.open([SPOT, 50, 21, 0, 0n, 100n * USD, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.open([SPOT, 50, 2, 0, 0n, 0n, await deadline()], { account: lp.account }), "InvalidAmount");
    const { id } = await open(lp, SPOT, 100, 6, 6, 10n * SHARE, 1_000n * USD);
    // A swap that would leave the price more than 5% from the NAV reverts.
    await expectRevert(router.write.swapExactInput([key, buyUstx, 5_000n * USD, 0n, await deadline()], { account: trader.account }), "OutsideBand(int24,int24)");
    // With the NAV 3% away, no position opens until the price follows it.
    await publish(103n * USD);
    await expectRevert(hook.write.open([SPOT, 50, 2, 2, 1n * SHARE, 100n * USD, await deadline()], { account: lp.account }), "PriceAwayFromNav(int24,int24)");
    // A stale NAV stops swaps but never a close.
    await time.increase(2n * HOUR);
    await expectRevert(router.write.swapExactInput([key, buyUstx, 10n * USD, 0n, await deadline()], { account: trader.account }), "NavTooOld(uint256)");
    await hook.write.close([id, 0n, 0n, await deadline()], { account: lp.account });
  });

  it("brings the pool back to the NAV through the fund, either way, and pays the keeper", async () => {
    const { hook, arbitrage, lp, keeper, prepare, open, publish, poolNav, dollar, publicClient } = await deploy();
    await prepare(lp, 5_000n * USD);
    await open(lp, SPOT, 50, 20, 20, 40n * SHARE, 4_000n * USD);
    await expectRevert(arbitrage.write.arbitrage([0n], { account: keeper.account }), "NothingToDo");
    // The NAV rises 2%: USTX is cheap in the pool, so the keeper buys it there and redeems it.
    await publish(102n * USD);
    const { result: profit } = await arbitrage.simulate.arbitrage([0n], { account: keeper.account });
    expect(profit > 0n).to.equal(true);
    const before = await dollar.read.balanceOf([keeper.account.address]);
    await arbitrage.write.arbitrage([0n], { account: keeper.account });
    // A block later the fee is a little higher, so the trade stops a little sooner.
    expect(Number((await dollar.read.balanceOf([keeper.account.address])) - before) / Number(profit)).to.be.closeTo(1, 0.01);
    const fee = Number(await hook.read.currentFee()) / 1e6;
    // The pool stops where its price less the fee meets the NAV.
    expect(Number(await poolNav()) / 1e6).to.be.closeTo(102 * (1 - fee), 0.05);
    // The NAV falls 4%: USTX is dear in the pool, so the keeper invests at the fund and sells there.
    await publish(98n * USD);
    const { result: second } = await arbitrage.simulate.arbitrage([0n], { account: keeper.account });
    expect(second > 0n).to.equal(true);
    const hash = await arbitrage.write.arbitrage([second * 98n / 100n], { account: keeper.account });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).to.equal("success");
    expect(Number(await poolNav()) / 1e6).to.be.closeTo(98 * (1 + Number(await hook.read.currentFee()) / 1e6), 0.05);
  });

  it("moves an empty stretch to the NAV for nothing, so positions can open again", async () => {
    const { hook, arbitrage, lp, keeper, prepare, open, publish, poolNav, dollar } = await deploy();
    await prepare(lp, 2_000n * USD);
    // No position at all, and the NAV moves 2%: a position cannot open until the price follows.
    await publish(102n * USD);
    await expectRevert(hook.write.open([SPOT, 20, 5, 5, 1n * SHARE, 100n * USD, BigInt(await time.latest()) + 3n * HOUR], { account: lp.account }), "PriceAwayFromNav(int24,int24)");
    const { result } = await arbitrage.simulate.arbitrage([0n], { account: keeper.account });
    expect(result).to.equal(0n);
    const before = await dollar.read.balanceOf([keeper.account.address]);
    await arbitrage.write.arbitrage([0n], { account: keeper.account });
    expect(await dollar.read.balanceOf([keeper.account.address])).to.equal(before);
    expect(Number(await poolNav()) / 1e6).to.be.closeTo(102 * (1 - Number(await hook.read.currentFee()) / 1e6), 0.05);
    await open(lp, SPOT, 20, 5, 5, 1n * SHARE, 100n * USD);
    // Demo dollars below the price only, and the NAV rises 2%: nothing above the price to buy, so
    // the arbitrage crosses the empty stretch; the NAV falls back and it sells into the dollars.
    await publish(104n * USD);
    expect(await arbitrage.simulate.arbitrage([0n], { account: keeper.account }).then(({ result }) => result >= 0n)).to.equal(true);
    await arbitrage.write.arbitrage([0n], { account: keeper.account });
    expect(Number(await poolNav()) / 1e6).to.be.closeTo(104 * (1 - Number(await hook.read.currentFee()) / 1e6), 0.06);
  });
});
