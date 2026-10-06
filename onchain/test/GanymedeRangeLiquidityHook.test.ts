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
const SPOT = 0, CURVE = 1, BID_ASK = 2, CUSTOM = 3;
/** Ticks that bound no price: TickMath's limits, for opens that do not test the caller's limit. */
const ANY_TICK = [-887_272, 887_272] as const;

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
    const hash = await hook.write.open([shape, binTicks, below, above, amount0, amount1, ...ANY_TICK, await deadline()], { account: wallet.account });
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

  it("opens a shape the provider draws bin by bin: each side shared by the weights, a bin of weight 0 left empty", async () => {
    const { hook, lp, prepare, assetIsCurrency0, publicClient } = await deploy();
    await prepare(lp, 3_000n * USD);
    // Five bins below the price and five above, lowest first: a ramp up to the price, then a gap and a tail.
    const weights = [1, 2, 3, 4, 10, 6, 0, 3, 3, 1];
    const [amount0, amount1] = assetIsCurrency0 ? [5n * SHARE, 1_000n * USD] : [1_000n * USD, 5n * SHARE];
    const hash = await hook.write.openCustom([50, 5, 5, weights, amount0, amount1, ...ANY_TICK, await deadline()], { account: lp.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const opened = parseEventLogs({ abi: hook.abi, logs: receipt.logs, eventName: "PositionOpened" })[0];
    expect(opened.args.shape).to.equal(CUSTOM);
    const [lowers, uppers, liquidity] = await hook.read.binsOf([opened.args.id]);
    expect(lowers.length).to.equal(10);
    for (let index = 0; index < 10; index++) expect(uppers[index] - lowers[index]).to.equal(50);
    // Each bin's liquidity follows its weight on its side, give or take the bins' prices; weight 0 stays empty.
    expect(liquidity[6]).to.equal(0n);
    expect(Number(liquidity[4]) / Number(liquidity[0])).to.be.closeTo(10, 0.4);
    expect(Number(liquidity[1]) / Number(liquidity[0])).to.be.closeTo(2, 0.1);
    expect(Number(liquidity[5]) / Number(liquidity[9])).to.be.closeTo(6, 0.3);
    expect(Number(liquidity[7]) / Number(liquidity[8])).to.be.closeTo(1, 0.03);
    // It takes at most what was given, and all but rounding.
    const [usedUstx, usedDollars] = assetIsCurrency0 ? [opened.args.amount0, opened.args.amount1] : [opened.args.amount1, opened.args.amount0];
    expect(usedUstx <= 5n * SHARE && usedUstx > 5n * SHARE - 20n).to.equal(true);
    expect(usedDollars <= 1_000n * USD && usedDollars > 1_000n * USD - 20n).to.equal(true);
    expect((await hook.read.positions([opened.args.id]))[1]).to.equal(CUSTOM);
    // It closes like any other position, the empty bin included.
    await hook.write.close([opened.args.id, 0n, 0n, await deadline()], { account: lp.account });
    expect((await hook.read.positions([opened.args.id]))[6]).to.equal(false);
  });

  it("refuses a drawing that does not fit: a weight per bin, some weight on each side with bins, and Custom only through openCustom", async () => {
    const { hook, lp, prepare, pair } = await deploy();
    await prepare(lp, 3_000n * USD);
    const [amount0, amount1] = pair(1n * SHARE, 100n * USD);
    await expectRevert(hook.write.openCustom([50, 2, 2, [1, 1, 1], amount0, amount1, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.openCustom([50, 2, 2, [0, 0, 1, 1], amount0, amount1, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.openCustom([50, 21, 0, Array(21).fill(1), 0n, 100n * USD, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.open([CUSTOM, 50, 2, 2, amount0, amount1, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    // A drawing within the caller's price limits is still held to them.
    await expectRevert(hook.write.openCustom([50, 2, 2, [1, 2, 2, 1], amount0, amount1, -887_272, -887_271, await deadline()], { account: lp.account }), "PriceOutsideLimit(int24,int24,int24)");
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

  it("opens only while the pool's price is within the caller's limits, so a price moved first cannot place the bins", async () => {
    const { hook, router, key, lp, trader, prepare, open, buyUstx, slot0, pair } = await deploy();
    await prepare(lp, 3_000n * USD);
    await prepare(trader, 0n);
    // Liquidity for the trade below to meet, so it moves the price a little, inside the NAV's band.
    await open(lp, SPOT, 20, 10, 10, 10n * SHARE, 1_000n * USD);
    const [amount0, amount1] = pair(5n * SHARE, 500n * USD);
    const { tick } = await slot0();
    // Limits that leave out the price now refuse the position.
    await expectRevert(hook.write.open([SPOT, 20, 5, 5, amount0, amount1, tick + 1, tick + 50, await deadline()], { account: lp.account }), "PriceOutsideLimit(int24,int24,int24)");
    // Another trade moves the price within the NAV's band before the position is mined: it is refused
    // at the limits the provider saw, rather than opened around the moved price.
    await router.write.swapExactInput([key, buyUstx, 100n * USD, 0n, await deadline()], { account: trader.account });
    const moved = (await slot0()).tick;
    expect(Math.abs(moved - tick) > 10, `moved ${tick} → ${moved}`).to.equal(true);
    await expectRevert(hook.write.open([SPOT, 20, 5, 5, amount0, amount1, tick - 10, tick + 10, await deadline()], { account: lp.account }), "PriceOutsideLimit(int24,int24,int24)");
    // Within its limits it opens around the price it found.
    await hook.write.open([SPOT, 20, 5, 5, amount0, amount1, moved - 10, moved + 10, await deadline()], { account: lp.account });
    expect((await hook.read.positionsOf([lp.account.address])).length).to.equal(2);
  });

  it("refuses liquidity outside its own, positions away from the NAV, bad shapes, and swaps on a stale NAV or out of the band", async () => {
    const { hook, router, key, lp, trader, prepare, open, publish, buyUstx, managerAddress, publicClient } = await deploy();
    const helper = modifyLiquidityTestArtifact();
    const helperHash = await trader.deployContract({ abi: helper.abi, bytecode: helper.bytecode, args: [managerAddress] });
    const outsider = getContract({ address: (await publicClient.waitForTransactionReceipt({ hash: helperHash })).contractAddress!, abi: helper.abi, client: { public: publicClient, wallet: trader } });
    await expectRevert(outsider.write.modifyLiquidity([key, { tickLower: 45_000, tickUpper: 47_000, liquidityDelta: 10n ** 9n, salt: `0x${"00".repeat(32)}` as Hex }, "0x"]), "LiquidityThroughHook");
    await prepare(lp, 3_000n * USD);
    await prepare(trader, 0n);
    await expectRevert(hook.write.open([SPOT, 15, 2, 2, 1n * SHARE, 100n * USD, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.open([SPOT, 50, 21, 0, 0n, 100n * USD, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidShape");
    await expectRevert(hook.write.open([SPOT, 50, 2, 0, 0n, 0n, ...ANY_TICK, await deadline()], { account: lp.account }), "InvalidAmount");
    const { id } = await open(lp, SPOT, 100, 6, 6, 10n * SHARE, 1_000n * USD);
    // A swap that would leave the price more than 5% from the NAV reverts.
    await expectRevert(router.write.swapExactInput([key, buyUstx, 5_000n * USD, 0n, await deadline()], { account: trader.account }), "OutsideBand(int24,int24)");
    // With the NAV 3% away, no position opens until the price follows it.
    await publish(103n * USD);
    await expectRevert(hook.write.open([SPOT, 50, 2, 2, 1n * SHARE, 100n * USD, ...ANY_TICK, await deadline()], { account: lp.account }), "PriceAwayFromNav(int24,int24)");
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
    await expectRevert(hook.write.open([SPOT, 20, 5, 5, 1n * SHARE, 100n * USD, ...ANY_TICK, BigInt(await time.latest()) + 3n * HOUR], { account: lp.account }), "PriceAwayFromNav(int24,int24)");
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

  it("sells into fewer bids than the fund's minimum with the caller's demo dollars, so the pool still comes back", async () => {
    const { hook, arbitrage, fund, dollar, lp, keeper, prepare, open, publish, poolNav, assetIsCurrency0 } = await deploy();
    await prepare(lp, 1_000n * USD);
    // The pool's only liquidity: $5 of demo dollars in 20 bins of 50 ticks under the price. (Dollar
    // bins are the pool's lower bins when USTX is currency0, its upper bins otherwise.)
    await open(lp, SPOT, 50, assetIsCurrency0 ? 20 : 0, assetIsCurrency0 ? 0 : 20, 0n, 5n * USD);
    // The NAV falls 3%. Selling USTX into those bids down to NAV / (1 − fee) receives about $1.37,
    // under the fund's $10 minimum investment, and no position can open meanwhile.
    await publish(97n * USD);
    await expectRevert(hook.write.open([SPOT, 50, 2, 2, 1n * SHARE, 100n * USD, ...ANY_TICK, await deadline()], { account: lp.account }), "PriceAwayFromNav(int24,int24)");
    // The caller makes up the difference only from demo dollars they have approved to the arbitrage.
    await expectRevert(arbitrage.simulate.arbitrage([0n], { account: keeper.account }), "InsufficientAllowance");
    await dollar.write.claim({ account: keeper.account });
    await dollar.write.approve([arbitrage.address, maxUint256], { account: keeper.account });
    const { result } = await arbitrage.simulate.arbitrage([0n], { account: keeper.account });
    expect(result).to.equal(0n);
    const held = () => Promise.all([dollar.read.balanceOf([keeper.account.address]), fund.read.balanceOf([keeper.account.address])]);
    const [dollarsBefore, sharesBefore] = await held();
    await arbitrage.write.arbitrage([0n], { account: keeper.account });
    const [dollarsAfter, sharesAfter] = await held();
    const put = dollarsBefore - dollarsAfter;
    const took = sharesAfter - sharesBefore;
    expect(put > 8n * USD && put < 9n * USD, `put in ${put}`).to.equal(true);
    // The USTX it bought beyond what the pool took is worth at the NAV more than what it put in.
    expect((took * 97n * USD) / SHARE > put, `took ${took} for ${put}`).to.equal(true);
    // The pool is back within its fee of the NAV, and positions open again.
    expect(Number(await poolNav()) / 1e6).to.be.closeTo(97 * (1 + Number(await hook.read.currentFee()) / 1e6), 0.05);
    await open(lp, SPOT, 50, 2, 2, 1n * SHARE, 100n * USD);
    expect(await dollar.read.balanceOf([arbitrage.address])).to.equal(0n);
    expect(await fund.read.balanceOf([arbitrage.address])).to.equal(0n);
  });

  it("keeps every provider's tokens, the NAV's band and its books across random opens, closes, trades, NAV moves and arbitrage", async () => {
    // RANGE_FUZZ_SEEDS and RANGE_FUZZ_STEPS run it longer; each seed replays.
    const seeds = Number(process.env.RANGE_FUZZ_SEEDS ?? 2);
    const steps = Number(process.env.RANGE_FUZZ_STEPS ?? 40);
    const { hook, arbitrage, router, key, lp, lp2, trader, keeper, prepare, publish, buyUstx, sellUstx, dollar, fund, managerAddress, publicClient, assetIsCurrency0, poolNav } = await deploy();
    await prepare(lp, 4_000n * USD);
    await prepare(lp2, 2_000n * USD);
    await prepare(trader, 3_000n * USD);
    await dollar.write.claim({ account: keeper.account });
    await dollar.write.approve([arbitrage.address, maxUint256], { account: keeper.account });
    const providers = [lp, lp2];
    const balances = async (account: `0x${string}`) => ({ ustx: await fund.read.balanceOf([account]), dollars: await dollar.read.balanceOf([account]) });
    // What the pool manager holds for its other pools, before any range position.
    const baseline = await balances(managerAddress);
    // A revert the rules call for (a price away from the NAV, a swap out of its band or on a stale
    // NAV, nothing to arbitrage) is counted; any other revert fails the run.
    const refusals = ["PriceAwayFromNav(int24,int24)", "OutsideBand(int24,int24)", "NavTooOld(uint256)", "NothingToDo()", "Unprofitable(uint256)", "PartialFill()"];
    const counts = { opened: 0, bins: 0, closed: 0, swaps: 0, arbitrages: 0, records: 0, refused: 0, stale: 0 };
    async function attempt(label: string, call: () => Promise<Hex>) {
      try {
        await publicClient.waitForTransactionReceipt({ hash: await call() });
        return true;
      } catch (caught) {
        const text = revertText(caught);
        if (refusals.some((signature) => new RegExp(`\\b${signature.replace(/\(.*$/, "")}\\b`).test(text) || text.toLowerCase().includes(selector(signature)))) {
          counts.refused += 1;
          return false;
        }
        throw new Error(`${label} reverted against the rules: ${text.slice(0, 400) || String(caught).slice(0, 400)}`);
      }
    }
    let nav = NAV;
    const open: { id: bigint; owner: typeof lp; bins: number }[] = [];

    // After every step: the hook and the arbitrage hold nothing, every open position is its owner's,
    // and the pool manager holds at least everything the open positions are owed, fees included.
    async function check(step: string) {
      for (const holder of [hook.address, arbitrage.address]) {
        const held = await balances(holder);
        expect(held.ustx + held.dollars, `${step}: ${holder} holds tokens`).to.equal(0n);
      }
      let owed0 = 0n, owed1 = 0n;
      for (const position of open) {
        const stored = await hook.read.positions([position.id]);
        expect(getAddress(stored[0]), `${step}: owner of ${position.id}`).to.equal(getAddress(position.owner.account.address));
        expect(stored[6], `${step}: ${position.id} open`).to.equal(true);
        // Each amount already counts its fees.
        const [amount0, amount1] = await hook.read.positionAmounts([position.id]);
        owed0 += amount0;
        owed1 += amount1;
      }
      const manager = await balances(managerAddress);
      const extra = { ustx: manager.ustx - baseline.ustx, dollars: manager.dollars - baseline.dollars };
      const [held0, held1] = assetIsCurrency0 ? [extra.ustx, extra.dollars] : [extra.dollars, extra.ustx];
      expect(owed0 <= held0 && owed1 <= held1, `${step}: owed ${owed0}/${owed1}, held ${held0}/${held1}`).to.equal(true);
    }

    for (let run = 0; run < seeds; run++) {
      let state = 0x2545f4914f6cdd1dn + BigInt(run);
      const random = (below: bigint) => {
        state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
        return (state >> 33n) % below;
      };
      const pick = <T,>(items: readonly T[]) => items[Number(random(BigInt(items.length)))];
      for (let step = 0; step < steps; step++) {
        const action = Number(random(10n));
        const label = `seed ${run} step ${step} action ${action}`;
        if (action <= 2) {
          // A provider opens bins of their own: a preset shape or one drawn bin by bin.
          const owner = pick(providers);
          const binTicks = pick([10, 20, 50, 100, 200, 500]);
          const held = await balances(owner.account.address);
          // The bins below the pool's tick hold currency1 and those above it currency0: demo dollars
          // below and USTX above when USTX is currency0, the other way round when it is not.
          const enough = { dollars: held.dollars >= 2n * USD, ustx: held.ustx >= SHARE / 5n };
          const lowToken = assetIsCurrency0 ? "dollars" : "ustx";
          const highToken = assetIsCurrency0 ? "ustx" : "dollars";
          let below = enough[lowToken] ? Number(random(7n)) : 0;
          let above = enough[highToken] ? Number(random(7n)) : 0;
          if (below + above === 0) {
            if (enough[highToken]) above = 1;
            else if (enough[lowToken]) below = 1;
            else continue;
          }
          const ustxBins = assetIsCurrency0 ? above : below;
          const dollarBins = assetIsCurrency0 ? below : above;
          const ustx = ustxBins > 0 ? SHARE / 10n + ((held.ustx - SHARE / 10n) / 4n) * random(1_000n) / 1_000n : 0n;
          const dollars = dollarBins > 0 ? USD + ((held.dollars - USD) / 4n) * random(1_000n) / 1_000n : 0n;
          const [amount0, amount1] = assetIsCurrency0 ? [ustx, dollars] : [dollars, ustx];
          const end = await deadline();
          const drawn = random(4n) === 0n;
          const weights = Array.from({ length: below + above }, () => Number(random(11n)));
          if (below > 0 && weights.slice(0, below).every((weight) => weight === 0)) weights[below - 1] = 1;
          if (above > 0 && weights.slice(below).every((weight) => weight === 0)) weights[below] = 1;
          const before = (await hook.read.positionsOf([owner.account.address])).length;
          const done = await attempt(label, () => drawn
            ? hook.write.openCustom([binTicks, below, above, weights, amount0, amount1, ...ANY_TICK, end], { account: owner.account })
            : hook.write.open([Number(random(3n)), binTicks, below, above, amount0, amount1, ...ANY_TICK, end], { account: owner.account }));
          if (done) {
            const ids = await hook.read.positionsOf([owner.account.address]);
            expect(ids.length, label).to.equal(before + 1);
            open.push({ id: ids[ids.length - 1], owner, bins: below + above });
            counts.opened += 1;
            counts.bins += below + above;
          }
        } else if (action === 3 && open.length > 0) {
          // A position closes for its owner, at any NAV, stale or not, with what it was owed.
          const index = Number(random(BigInt(open.length)));
          const position = open[index];
          const other = providers.find((provider) => provider !== position.owner)!;
          if (step % 7 === 0) await expectRevert(hook.write.close([position.id, 0n, 0n, await deadline()], { account: other.account }), "NotOwner");
          const [amount0, amount1] = await hook.read.positionAmounts([position.id]);
          const before = await balances(position.owner.account.address);
          await hook.write.close([position.id, 0n, 0n, await deadline()], { account: position.owner.account });
          const after = await balances(position.owner.account.address);
          const [got0, got1] = assetIsCurrency0 ? [after.ustx - before.ustx, after.dollars - before.dollars] : [after.dollars - before.dollars, after.ustx - before.ustx];
          const slack = BigInt(position.bins * 2 + 2);
          expect(got0 + slack >= amount0 && got0 <= amount0 + slack, `${label}: paid ${got0} of ${amount0}`).to.equal(true);
          expect(got1 + slack >= amount1 && got1 <= amount1 + slack, `${label}: paid ${got1} of ${amount1}`).to.equal(true);
          open.splice(index, 1);
          counts.closed += 1;
        } else if (action === 4 || action === 5) {
          // A trader buys or sells; a swap that went through leaves the price within the NAV's band.
          const held = await balances(trader.account.address);
          const buying = action === 4 ? held.dollars >= 2n * USD : held.ustx < SHARE / 50n;
          const amount = buying ? USD + (held.dollars / 5n) * random(1_000n) / 1_000n : SHARE / 100n + (held.ustx / 5n) * random(1_000n) / 1_000n;
          const end = await deadline();
          if (await attempt(label, () => router.write.swapExactInput([key, buying ? buyUstx : sellUstx, amount, 0n, end], { account: trader.account }))) {
            counts.swaps += 1;
            const away = Number(await poolNav()) / Number(nav) - 1;
            expect(Math.abs(away) <= 0.053, `${label}: the price is ${(away * 100).toFixed(2)}% from the NAV`).to.equal(true);
          }
        } else if (action === 6) {
          // A new record moves the NAV up to 2% either way.
          nav = (nav * (9_800n + random(401n))) / 10_000n;
          await publish(nav);
          counts.records += 1;
        } else if (action === 7) {
          if (await attempt(label, () => arbitrage.write.arbitrage([0n], { account: keeper.account }))) counts.arbitrages += 1;
        } else if (action === 8 && random(5n) === 0n) {
          // Now and then the record goes stale: swaps stop, closes do not.
          await time.increase(65n * 60n);
          counts.stale += 1;
        } else {
          await time.increase(60n + random(600n));
        }
        await check(label);
      }
      // Keep the record fresh into the next seed.
      await publish(nav);
    }

    // Everyone leaves, at a stale NAV too: every position closes for what it is owed, and the pool
    // manager keeps only rounding, which goes the pool's way: at most a couple of micros a bin.
    await time.increase(2n * HOUR);
    for (const position of [...open]) {
      await hook.write.close([position.id, 0n, 0n, await deadline()], { account: position.owner.account });
      open.splice(open.indexOf(position), 1);
      counts.closed += 1;
    }
    await check("after everyone left");
    const manager = await balances(managerAddress);
    const left = { ustx: manager.ustx - baseline.ustx, dollars: manager.dollars - baseline.dollars };
    const dust = BigInt(2 * counts.bins + 10);
    expect(left.ustx >= 0n && left.dollars >= 0n && left.ustx <= dust && left.dollars <= dust, `left ${left.ustx} micro-USTX and ${left.dollars} micro-dollars over ${counts.bins} bins`).to.equal(true);
    expect(counts.opened > 0 && counts.swaps > 0, JSON.stringify(counts)).to.equal(true);
    console.log(`      range fuzz: ${JSON.stringify(counts)}`);
  }).timeout(0); // its length follows RANGE_FUZZ_SEEDS and RANGE_FUZZ_STEPS
});
