import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, getContract, maxUint256, parseAbi, parseEventLogs, toFunctionSelector, zeroAddress, type Address, type Hash, type Hex } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";
import { applyEvents, type LpMarkout } from "../../lib/xstocks/lp-markout";
import {
  ALL_HOOK_MASK,
  CREATE2_PROXY,
  CREATE2_PROXY_CODE,
  DYNAMIC_FEE_FLAG,
  RWA_HOOK_FLAGS,
  deployRwaLiquidity,
  donateTestArtifact,
  modifyLiquidityTestArtifact,
  navSqrtPriceX96,
  poolIdOf,
  poolManagerArtifact,
  readLiquidity,
  readSlot0,
  type PoolKey,
} from "../scripts/_v4";

// The pool manager's Swap event, typed for parsing receipts.
const POOL_MANAGER_EVENTS = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);
const USTX = productKey("us-tech-x");
const HOLDINGS = toBytes32("3858e1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c296fb");
const USD = 1_000_000n;
const SHARE = 1_000_000n;
const NAV = 100n * USD; // $100 per USTX keeps the arithmetic readable
const HOUR = 3_600n;

// Fee at a NAV `age` seconds old, in hundredths of a basis point: 0.30% rising to 1.00% at an hour.
const feeAt = (age: bigint) => 3_000n + (7_000n * age) / HOUR;
const selector = (signature: string) => toFunctionSelector(signature).slice(2);

function expectClose(actual: bigint, expected: bigint, tolerance: bigint) {
  const gap = actual > expected ? actual - expected : expected - actual;
  expect(gap <= tolerance, `${actual} is not within ${tolerance} of ${expected}`).to.equal(true);
}

/**
 * The revert reasons and raw revert data in an error and its causes, without the ABI and call
 * details viem attaches (which would name every error the contract has).
 */
function revertText(error: unknown): string {
  const parts: string[] = [];
  let current = error as Record<string, unknown> | undefined;
  for (let depth = 0; current && depth < 10; depth++) {
    for (const key of ["details", "raw", "signature", "reason"]) {
      if (typeof current[key] === "string") parts.push(current[key] as string);
    }
    const data = current.data as Record<string, unknown> | string | undefined;
    if (typeof data === "string") parts.push(data);
    else if (data && typeof data.errorName === "string") parts.push(data.errorName);
    current = current.cause as Record<string, unknown> | undefined;
  }
  return parts.join(" ");
}

/**
 * Asserts a revert with `error`: by name when the node or viem decodes it, by selector when it
 * sits inside the pool manager's WrappedError. `error` is a signature when the error has arguments.
 */
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

async function deploy(options: { assetFirst?: boolean; nav?: bigint } = {}) {
  const [admin, relayer, lp, lp2, trader, keeper, other] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
  // The pool sorts its tokens by address; redeploy until USTX lands on the side a test asks for.
  let dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
  let fund = await hre.viem.deployContract("GanymedeBasketFund", [
    "Ganymede US Tech Basket",
    "USTX",
    dollar.address,
    registry.address,
    USTX,
    admin.account.address,
  ]);
  while (options.assetFirst !== undefined && (BigInt(fund.address) < BigInt(dollar.address)) !== options.assetFirst) {
    dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    fund = await hre.viem.deployContract("GanymedeBasketFund", [
      "Ganymede US Tech Basket",
      "USTX",
      dollar.address,
      registry.address,
      USTX,
      admin.account.address,
    ]);
  }
  await dollar.write.setMinter([fund.address], { account: admin.account });
  const feed = await hre.viem.deployContract("GanymedeNavFeed", [registry.address, USTX, "USTX / USD"]);

  async function publish(nav: bigint, effectiveAt?: bigint) {
    await time.increase(60);
    await registry.write.publishNav([USTX, nav, 0n, HOLDINGS, effectiveAt ?? BigInt(await time.latest())], { account: relayer.account });
  }
  await publish(options.nav ?? NAV);

  // The same routine `npm run deploy:v4` runs: Uniswap's PoolManager, the hook at a mined CREATE2
  // address (opening its pool at the NAV) and the router.
  await hre.network.provider.request({ method: "hardhat_setCode", params: [CREATE2_PROXY, CREATE2_PROXY_CODE] });
  const hookArtifact = await hre.artifacts.readArtifact("GanymedeRwaLiquidityHook");
  const routerArtifact = await hre.artifacts.readArtifact("GanymedeV4Router");
  const deployed = await deployRwaLiquidity({
    wallet: admin,
    publicClient,
    hookArtifact: { abi: hookArtifact.abi, bytecode: hookArtifact.bytecode as Hex },
    routerArtifact: { abi: routerArtifact.abi, bytecode: routerArtifact.bytecode as Hex },
    asset: fund.address,
    dollar: dollar.address,
    feed: feed.address,
    name: "Ganymede USTX-dUSD v4 LP",
    symbol: "USTX-V4LP",
  });
  const pm = poolManagerArtifact();
  const managerAddress = deployed.poolManager.address;
  const hook = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", deployed.hook.address);
  const router = await hre.viem.getContractAt("GanymedeV4Router", deployed.router.address);

  const assetIsCurrency0 = BigInt(fund.address) < BigInt(dollar.address);
  const key: PoolKey = {
    currency0: getAddress(assetIsCurrency0 ? fund.address : dollar.address),
    currency1: getAddress(assetIsCurrency0 ? dollar.address : fund.address),
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: 10,
    hooks: getAddress(hook.address),
  };
  const poolId = poolIdOf(key);
  // Orders amounts as the pool does: currency0 first.
  const pair = (ustx: bigint, dollars: bigint): [bigint, bigint] => (assetIsCurrency0 ? [ustx, dollars] : [dollars, ustx]);
  const split = ([amount0, amount1]: readonly [bigint, bigint]) => (assetIsCurrency0 ? { ustx: amount0, dollars: amount1 } : { ustx: amount1, dollars: amount0 });
  // Buying USTX sells dUSD into the pool: currency1 → currency0 when USTX is currency0.
  const buyUstx = !assetIsCurrency0;
  const sellUstx = assetIsCurrency0;

  /** 10,000 demo dollars, `invest` of them turned into USTX at the fund, and approvals for the hook and router. */
  async function prepare(wallet: typeof admin, invest = 0n) {
    await dollar.write.claim({ account: wallet.account });
    for (const spender of [fund.address, hook.address, router.address]) {
      await dollar.write.approve([spender, maxUint256], { account: wallet.account });
    }
    for (const spender of [hook.address, router.address]) {
      await fund.write.approve([spender, maxUint256], { account: wallet.account });
    }
    if (invest > 0n) await fund.write.invest([invest, 0n], { account: wallet.account });
  }

  const slot0 = () => readSlot0(publicClient, managerAddress, poolId);
  /** The pool's price as dollar micros per USTX. */
  const poolNav = async () => {
    const { sqrtPriceX96 } = await slot0();
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    return assetIsCurrency0 ? (priceX192 * SHARE) / (1n << 192n) : ((1n << 192n) * SHARE) / priceX192;
  };
  const liquidity = () => readLiquidity(publicClient, managerAddress, poolId);
  const expectedSqrt = (nav: bigint) => navSqrtPriceX96(nav * 100n, 8, 6, 6, assetIsCurrency0);
  /** Holdings valued at `nav`, in dollar micros. */
  const valueAt = async (nav: bigint) => {
    const { ustx, dollars } = split(await hook.read.totalAmounts());
    return (ustx * nav) / SHARE + dollars;
  };
  async function receipt(hash: Hash) {
    return publicClient.waitForTransactionReceipt({ hash });
  }
  async function events(hash: Hash) {
    const { logs } = await receipt(hash);
    return parseEventLogs({ abi: [...hook.abi, ...router.abi, ...POOL_MANAGER_EVENTS], logs });
  }
  const manager = getContract({ address: managerAddress, abi: pm.abi, client: { public: publicClient, wallet: admin } });

  /** Deposits `ustx` USTX and `dollars` dUSD as maxima (the first deposit takes both in full). */
  async function seed(wallet: typeof admin, ustx = 50n * SHARE, dollars = 5_000n * USD) {
    const [amount0, amount1] = pair(ustx, dollars);
    return hook.write.deposit([amount0, amount1, await deadline()], { account: wallet.account });
  }
  /** Records the NAV again and lets a keeper re-peg, which turns waiting deposits into shares. */
  async function nextRecord(nav: bigint) {
    await publish(nav);
    return hook.write.repeg({ account: keeper.account });
  }
  /** Buys USTX with exactly `dollars` dUSD through the router. */
  async function buy(wallet: typeof admin, dollars: bigint) {
    return router.write.swapExactInput([key, buyUstx, dollars, 0n, await deadline()], { account: wallet.account });
  }
  /** Sells exactly `shares` USTX through the router. */
  async function sell(wallet: typeof admin, shares: bigint) {
    return router.write.swapExactInput([key, sellUstx, shares, 0n, await deadline()], { account: wallet.account });
  }
  /** The fee the pool manager charged in a swap transaction, and the one expected for the NAV's age then. */
  async function swapFee(hash: Hash) {
    const { blockNumber } = await receipt(hash);
    const block = await publicClient.getBlock({ blockNumber });
    const [, , , effectiveAt] = await registry.read.latestNav([USTX]);
    const swaps = (await events(hash)).filter(event => event.eventName === "Swap" && event.args.fee > 0);
    const charged = swaps.at(-1)!.args as { fee: number };
    const age = block.timestamp > BigInt(effectiveAt) ? block.timestamp - BigInt(effectiveAt) : 0n;
    return { charged: BigInt(charged.fee), expected: feeAt(age) };
  }

  return {
    admin, relayer, lp, lp2, trader, keeper, other, publicClient,
    registry, dollar, fund, feed, hook, router, manager, managerAddress,
    key, poolId, assetIsCurrency0, pair, split, buyUstx, sellUstx,
    publish, nextRecord, prepare, slot0, poolNav, liquidity, expectedSqrt, valueAt, receipt, events, seed, buy, sell, swapFee,
  };
}

// Past the time jumps the tests make.
async function deadline() {
  return BigInt(await time.latest()) + 3n * HOUR;
}

describe("GanymedeRwaLiquidityHook", () => {
  it("opens its own pool at the NAV and carries its permissions in its address", async () => {
    const { hook, key, poolId, fund, dollar, feed, managerAddress, assetIsCurrency0, slot0, expectedSqrt } = await deploy();
    expect(BigInt(hook.address) & ALL_HOOK_MASK).to.equal(RWA_HOOK_FLAGS);
    const onChainKey = await hook.read.poolKey();
    expect(onChainKey).to.deep.equal(key);
    expect(await hook.read.poolId()).to.equal(poolId);
    expect(getAddress(await hook.read.poolManager())).to.equal(getAddress(managerAddress));
    expect(getAddress(await hook.read.asset())).to.equal(getAddress(fund.address));
    expect(getAddress(await hook.read.dollar())).to.equal(getAddress(dollar.address));
    expect(getAddress(await hook.read.navFeed())).to.equal(getAddress(feed.address));
    expect(await hook.read.assetIsCurrency0()).to.equal(assetIsCurrency0);
    expect(await hook.read.decimals()).to.equal(6);
    expect(await hook.read.symbol()).to.equal("USTX-V4LP");
    expect(await hook.read.totalSupply()).to.equal(0n);

    const price = await slot0();
    expect(price.sqrtPriceX96).to.equal(expectedSqrt(NAV));
    expect(price.lpFee).to.equal(0);
    const [answer, , sqrtPriceX96] = await hook.read.nav();
    expect(answer).to.equal(NAV * 100n);
    expect(sqrtPriceX96).to.equal(price.sqrtPriceX96);
  });

  it("maps any NAV to the pool price exactly, both ways round", async () => {
    for (const assetFirst of [true, false]) {
      const { hook, publish } = await deploy({ assetFirst });
      // From a hundredth of a cent to a billion dollars a share, and awkward digits in between.
      for (const nav of [100n, 7_777n, 999_999n, 1_000_000n, 1_000_001n, 99_449_929n, 123_456_789_012n, 10n ** 15n]) {
        await publish(nav);
        const [answer, , sqrtPriceX96] = await hook.read.nav();
        expect(answer).to.equal(nav * 100n);
        expect(sqrtPriceX96).to.equal(navSqrtPriceX96(nav * 100n, 8, 6, 6, assetFirst));
      }
    }
  });

  it("mints the first deposit's value at the NAV, locks the minimum and centres the ranges on the NAV", async () => {
    const { hook, lp, pair, split, prepare, slot0, liquidity, valueAt, events, seed, publish } = await deploy();
    await prepare(lp, 5_000n * USD);
    // Below $10 at the NAV, and with a stale NAV, the first deposit is refused.
    await expectRevert(hook.write.deposit([...pair(0n, 9_999_999n), await deadline()], { account: lp.account }), "BelowMinimum");
    await time.increase(HOUR + 1n);
    await expectRevert(hook.write.deposit([...pair(50n * SHARE, 5_000n * USD), await deadline()], { account: lp.account }), "NavTooOld(uint256)");
    await publish(NAV);

    const previewShares = await hook.read.estimateShares(pair(50n * SHARE, 5_000n * USD));
    expect(previewShares).to.equal(10_000n * USD - 1_000n);
    expect(await hook.read.previewDeposit(pair(50n * SHARE, 5_000n * USD))).to.deep.equal(pair(50n * SHARE, 5_000n * USD));
    await expectRevert(hook.write.deposit([...pair(50n * SHARE, 5_000n * USD), BigInt(await time.latest())], { account: lp.account }), "Expired");

    const logs = await events(await seed(lp));
    const deposited = logs.find(event => event.eventName === "Deposited")!.args as { epoch: bigint; amount0: bigint; amount1: bigint };
    expect(deposited.epoch).to.equal(0n);
    expect(split([deposited.amount0, deposited.amount1])).to.deep.equal({ ustx: 50n * SHARE, dollars: 5_000n * USD });
    // The first deposit's shares arrive at once, and opening the ranges is the first re-peg.
    expect(await hook.read.epoch()).to.equal(1n);
    expect(await hook.read.totalSupply()).to.equal(10_000n * USD);
    expect(await hook.read.balanceOf([zeroAddress])).to.equal(1_000n);
    expect(await hook.read.balanceOf([lp.account.address])).to.equal(previewShares);

    // The ranges sit around the NAV's tick: the base range on both sides, the few units it could
    // not use one-sided next to it.
    const { tick, sqrtPriceX96 } = await slot0();
    const center = Math.floor(tick / 10) * 10;
    const repegged = logs.find(event => event.eventName === "Repegged")!.args as Record<string, bigint | number>;
    expect(repegged.sqrtPriceX96).to.equal(sqrtPriceX96);
    const [baseLower, baseUpper, baseLiquidity] = await hook.read.baseRange();
    expect([baseLower, baseUpper]).to.deep.equal([center - 200, center + 210]);
    const [limitLower, limitUpper, limitLiquidity] = await hook.read.limitRange();
    expect([[center - 300, center], [center + 10, center + 310]]).to.deep.include([limitLower, limitUpper]);
    expect(limitLiquidity < baseLiquidity / 10n).to.equal(true);
    // Only the base range is in range at the NAV.
    expect(await liquidity()).to.equal(baseLiquidity);
    // Everything is at work but a few base units of rounding (one USTX unit is $0.0001), and the
    // holdings are worth the deposit.
    expect((await hook.read.idle0()) + (await hook.read.idle1()) < 10n).to.equal(true);
    const value = await valueAt(NAV);
    expect(value <= 10_000n * USD && value > 10_000n * USD - 300n).to.equal(true);
    expect(await hook.read.totalValue()).to.equal(value);
  });

  it("prices later deposits at the next NAV record, where they go to work", async () => {
    const { hook, lp, lp2, trader, keeper, pair, split, prepare, liquidity, valueAt, seed, buy, publish, events } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 2_000n * USD);
    await prepare(trader);
    await seed(lp);
    await buy(trader, 1_000n * USD); // the pool now holds fewer USTX and more dollars
    const supply = await hook.read.totalSupply();
    const held = split(await hook.read.totalAmounts());

    // 20 USTX and $2,000 on offer: the dollars bind, since the pool holds about $150 per USTX, and
    // each token is taken at its share of the holdings, rounded up.
    const [amount0, amount1] = await hook.read.previewDeposit(pair(20n * SHARE, 2_000n * USD));
    const cost = split([amount0, amount1]);
    expect(cost.dollars <= 2_000n * USD && cost.dollars > 2_000n * USD - 2n).to.equal(true);
    expect(cost.ustx < 20n * SHARE).to.equal(true);
    const byDollars = (2_000n * USD * supply) / held.dollars;
    expect(cost.ustx).to.equal((held.ustx * byDollars + supply - 1n) / supply);

    const rangesBefore = [await hook.read.baseRange(), await hook.read.limitRange()];
    const liquidityBefore = await liquidity();
    const valueBefore = await valueAt(NAV);
    const logs = await events(await seed(lp2, 20n * SHARE, 2_000n * USD));
    const deposited = logs.find(event => event.eventName === "Deposited")!.args as { epoch: bigint; amount0: bigint; amount1: bigint };
    expect([deposited.epoch, deposited.amount0, deposited.amount1]).to.deep.equal([1n, amount0, amount1]);
    // It waits for the next record: no shares yet, and the ranges, the pool's liquidity and what the
    // existing shares own are unchanged.
    expect(await hook.read.balanceOf([lp2.account.address])).to.equal(0n);
    expect(await hook.read.pendingOf([lp2.account.address])).to.deep.equal([amount0, amount1, 1n]);
    expect([await hook.read.pending0(), await hook.read.pending1()]).to.deep.equal([amount0, amount1]);
    expect([await hook.read.baseRange(), await hook.read.limitRange()]).to.deep.equal(rangesBefore);
    expect(await liquidity()).to.equal(liquidityBefore);
    expect(await valueAt(NAV)).to.equal(valueBefore);
    expect(await hook.read.claimableShares([lp2.account.address])).to.equal(0n);

    // The next NAV record converts it: a keeper re-pegs without waiting for a swap.
    expect((await hook.simulate.repeg({ account: keeper.account.address })).result).to.equal(false);
    await publish(NAV);
    const estimate = await hook.read.estimateShares([amount0, amount1]);
    expect((await hook.simulate.repeg({ account: keeper.account.address })).result).to.equal(true);
    const converted = (await events(await hook.write.repeg({ account: keeper.account }))).find(event => event.eventName === "Converted")!
      .args as { epoch: bigint; navAnswer: bigint; value: bigint; shares: bigint };
    // Its value at the NAV against everything the shares owned, fees included.
    const depositValue = (cost.ustx * NAV) / SHARE + cost.dollars;
    expect(converted.epoch).to.equal(1n);
    expect(converted.value).to.equal(depositValue);
    expect(converted.shares).to.equal((depositValue * supply) / valueBefore);
    expectClose(converted.shares, estimate, estimate / 1_000_000n);
    expect(await hook.read.epoch()).to.equal(2n);
    expect([await hook.read.pending0(), await hook.read.pending1()]).to.deep.equal([0n, 0n]);
    expect((await hook.read.idle0()) + (await hook.read.idle1()) < 10n).to.equal(true);
    expect((await liquidity()) > liquidityBefore).to.equal(true);

    // The depositor claims the shares; anyone can pay them out, and they arrive once.
    expect(await hook.read.claimableShares([lp2.account.address])).to.equal(converted.shares);
    await hook.write.claimShares([lp2.account.address], { account: trader.account });
    expect(await hook.read.balanceOf([lp2.account.address])).to.equal(converted.shares);
    expect(await hook.read.claimableShares([lp2.account.address])).to.equal(0n);
    expect(await hook.read.balanceOf([hook.address])).to.equal(0n);
    // Shares now worth what was deposited, at the NAV, less rounding.
    const worth = ((await valueAt(NAV)) * converted.shares) / (await hook.read.totalSupply());
    expect(worth <= depositValue && worth > depositValue - 1_000n).to.equal(true);

    // A deposit that offers nothing of a token the pool holds takes nothing.
    await expectRevert(hook.write.deposit([...pair(0n, 1_000n * USD), await deadline()], { account: lp2.account }), "InvalidAmount");
  });

  it("gives a deposit made just before a trade none of that trade's gain", async () => {
    // A deposit priced on the holdings at once would share in the fees and spread of a trade made
    // while its tokens sat idle; priced at the next record, it gets back what it put in.
    const { hook, dollar, fund, lp, lp2, trader, split, prepare, seed, buy, nextRecord, valueAt } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 5_000n * USD);
    await prepare(trader);
    await seed(lp);
    const lpValue = await valueAt(NAV);
    await seed(lp2, 50n * SHARE, 5_000n * USD);
    const [sniper0, sniper1] = await hook.read.pendingOf([lp2.account.address]);
    await buy(trader, 2_000n * USD);
    const gain = (await valueAt(NAV)) - lpValue;
    expect(gain > 10n * USD).to.equal(true); // the fee and the spread over the NAV

    // Cancelling returns the deposit exactly; the gain stays with the shares that took the trade.
    const ustxBefore = await fund.read.balanceOf([lp2.account.address]);
    const dollarsBefore = await dollar.read.balanceOf([lp2.account.address]);
    await hook.write.cancelDeposit({ account: lp2.account });
    const returned = split([sniper0, sniper1]);
    expect((await fund.read.balanceOf([lp2.account.address])) - ustxBefore).to.equal(returned.ustx);
    expect((await dollar.read.balanceOf([lp2.account.address])) - dollarsBefore).to.equal(returned.dollars);
    expect(await hook.read.pendingOf([lp2.account.address])).to.deep.equal([0n, 0n, 0n]);
    expect((await valueAt(NAV)) - lpValue).to.equal(gain);
    await expectRevert(hook.write.cancelDeposit({ account: lp2.account }), "NothingToCancel");

    // Waiting instead, it is priced after the trade: its shares are worth its deposit, not a part of the gain.
    await seed(lp2, 50n * SHARE, 5_000n * USD);
    const [again0, again1] = await hook.read.pendingOf([lp2.account.address]);
    await buy(trader, 1_000n * USD);
    await nextRecord(NAV);
    await expectRevert(hook.write.cancelDeposit({ account: lp2.account }), "NothingToCancel"); // it is shares now
    await hook.write.claimShares([lp2.account.address], { account: lp2.account });
    const deposited = split([again0, again1]);
    const shares = await hook.read.balanceOf([lp2.account.address]);
    const worth = ((await valueAt(NAV)) * shares) / (await hook.read.totalSupply());
    const put = (deposited.ustx * NAV) / SHARE + deposited.dollars;
    expect(worth <= put && worth > put - 1_000n).to.equal(true);
  });

  it("applies a record before taking a deposit, so the deposit cannot convert just ahead of a trade", async () => {
    // A record has landed and nobody has re-pegged yet. Converting a deposit at that record would put
    // it in range for the next swap, which its depositor may already see; so the deposit re-pegs first
    // and waits for a record published after it.
    const { hook, keeper, lp, lp2, trader, dollar, fund, split, prepare, seed, buy, publish, valueAt, events } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 5_000n * USD);
    await prepare(trader);
    await seed(lp);
    await publish(NAV);
    const epochBefore = await hook.read.epoch();
    const logs = await events(await seed(lp2, 50n * SHARE, 5_000n * USD));
    expect(logs.some(event => event.eventName === "Repegged")).to.equal(true);
    expect(await hook.read.epoch()).to.equal(epochBefore + 1n);
    const [waiting0, waiting1, waitingEpoch] = await hook.read.pendingOf([lp2.account.address]);
    expect(waitingEpoch).to.equal(epochBefore + 1n);
    expect((await hook.simulate.repeg({ account: keeper.account.address })).result).to.equal(false);

    const lpValue = await valueAt(NAV);
    await buy(trader, 2_000n * USD);
    const gain = (await valueAt(NAV)) - lpValue;
    expect(gain > 10n * USD).to.equal(true);
    expect(await hook.read.claimableShares([lp2.account.address])).to.equal(0n);
    const ustxBefore = await fund.read.balanceOf([lp2.account.address]);
    const dollarsBefore = await dollar.read.balanceOf([lp2.account.address]);
    await hook.write.cancelDeposit({ account: lp2.account });
    const returned = split([waiting0, waiting1]);
    expect((await fund.read.balanceOf([lp2.account.address])) - ustxBefore).to.equal(returned.ustx);
    expect((await dollar.read.balanceOf([lp2.account.address])) - dollarsBefore).to.equal(returned.dollars);
    expect((await valueAt(NAV)) - lpValue).to.equal(gain);
  });

  it("sizes a deposit that applies a record itself against the shares that record minted", async () => {
    // Emptied down to its locked shares, the pool holds little next to a deposit waiting for the next
    // record. A later deposit that applies that record itself must count the shares it minted, or it
    // would be taken in coarse steps: a small one would revert and a larger one would take less.
    const { hook, lp, lp2, other, keeper, prepare, seed, publish, pair } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 5_000n * USD);
    await prepare(other, 1_000n * USD);
    await seed(lp);
    await hook.write.withdraw([await hook.read.balanceOf([lp.account.address]), 0n, 0n, await deadline()], { account: lp.account });
    expect(await hook.read.totalSupply()).to.equal(1_000n);
    await seed(lp2, 45n * SHARE, 4_500n * USD);
    await publish(NAV);
    const offers = [pair(3n * SHARE / 100n, 3n * USD), pair(9n * SHARE, 900n * USD)];
    const applying = [];
    for (const offer of offers) {
      applying.push((await hook.simulate.deposit([...offer, await deadline()], { account: other.account.address })).result);
    }
    expect(applying.every(([shares]) => shares === 0n)).to.equal(true);
    await hook.write.repeg({ account: keeper.account });
    for (const [index, offer] of offers.entries()) {
      const [, amount0, amount1] = (await hook.simulate.deposit([...offer, await deadline()], { account: other.account.address })).result;
      expect([applying[index][1], applying[index][2]]).to.deep.equal([amount0, amount1]);
    }
  });

  it("lets an unbounded maximum follow the other token", async () => {
    const { hook, lp, lp2, prepare, seed, pair, events } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 5_000n * USD);
    await seed(lp);
    // Ten USTX need about $1,000, so USTX decides with $10,000 on offer, and with no limit at all.
    const bounded = await hook.read.previewDeposit(pair(10n * SHARE, 10_000n * USD));
    expect(await hook.read.previewDeposit(pair(10n * SHARE, maxUint256))).to.deep.equal(bounded);
    const deposited = (await events(await hook.write.deposit([...pair(10n * SHARE, maxUint256), await deadline()], { account: lp2.account })))
      .find(event => event.eventName === "Deposited")!.args as { amount0: bigint; amount1: bigint };
    expect([deposited.amount0, deposited.amount1]).to.deep.equal([...bounded]);
  });

  it("pays withdrawals their share of the ranges, fees and idle balances, with any NAV", async () => {
    const { hook, lp, lp2, trader, fund, dollar, split, prepare, seed, buy, sell, events } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 2_000n * USD);
    await prepare(trader, 2_000n * USD);
    await seed(lp);
    await seed(lp2, 20n * SHARE, 2_000n * USD); // waits for the next record, which never comes here
    for (let round = 0; round < 3; round++) {
      await buy(trader, 500n * USD);
      await sell(trader, 5n * SHARE);
    }
    const before = split(await hook.read.totalAmounts());
    const lpShares = await hook.read.balanceOf([lp.account.address]);
    const half = lpShares / 2n;
    const [preview0, preview1] = await hook.read.previewWithdraw([half]);
    await expectRevert(hook.write.withdraw([half, preview0 + 1n, 0n, await deadline()], { account: lp.account }), "SlippageExceeded");

    // An hour and more without a NAV record stops swaps, not withdrawals.
    await time.increase(HOUR + 1n);
    await expectRevert(hook.read.nav(), "NavTooOld(uint256)");
    const ustxBefore = await fund.read.balanceOf([lp.account.address]);
    const dollarsBefore = await dollar.read.balanceOf([lp.account.address]);
    const [late0, late1] = await hook.read.previewWithdraw([half]);
    expect([late0, late1]).to.deep.equal([preview0, preview1]);
    const logs = await events(await hook.write.withdraw([half, preview0, preview1, await deadline()], { account: lp.account }));
    const withdrawn = logs.find(event => event.eventName === "Withdrawn")!.args as { shares: bigint; amount0: bigint; amount1: bigint };
    expect([withdrawn.amount0, withdrawn.amount1]).to.deep.equal([preview0, preview1]);
    const paid = split([preview0, preview1]);
    expect((await fund.read.balanceOf([lp.account.address])) - ustxBefore).to.equal(paid.ustx);
    expect((await dollar.read.balanceOf([lp.account.address])) - dollarsBefore).to.equal(paid.dollars);
    // The payout is the shares' part of everything held, fees included, rounded down.
    const supply = await hook.read.totalSupply();
    expect(paid.ustx <= (before.ustx * half) / (supply + half)).to.equal(true);
    expect(paid.dollars <= (before.dollars * half) / (supply + half)).to.equal(true);
    expect(paid.dollars > (before.dollars * half) / (supply + half) - 10n).to.equal(true);

    await expectRevert(hook.write.withdraw([lpShares, 0n, 0n, await deadline()], { account: lp.account }), "InsufficientBalance");
    await expectRevert(hook.write.withdraw([0n, 0n, 0n, await deadline()], { account: lp.account }), "InvalidAmount");
    // Everyone can leave, the waiting deposit by cancelling it; what stays belongs to the locked shares.
    await hook.write.withdraw([lpShares - half, 0n, 0n, await deadline()], { account: lp.account });
    await hook.write.cancelDeposit({ account: lp2.account });
    expect(await hook.read.totalSupply()).to.equal(1_000n);
    expect([await hook.read.pending0(), await hook.read.pending1()]).to.deep.equal([0n, 0n]);
    const left = split(await hook.read.totalAmounts());
    expect(left.ustx * NAV / SHARE + left.dollars < 10_000n).to.equal(true); // under a cent
  });

  it("trades through the NAV-centred ranges at a fee that rises with the NAV's age", async () => {
    const { hook, router, lp, trader, key, buyUstx, fund, dollar, registry, prepare, seed, buy, sell, swapFee, valueAt } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(trader, 1_000n * USD);
    await seed(lp);

    // $1,000 of USTX from a $10,000 pool: the NAV, the fee and the curve's slippage.
    const valueBefore = await valueAt(NAV);
    const quoted = (await router.simulate.quoteExactInput([key, buyUstx, 1_000n * USD], { account: trader.account.address })).result;
    const ustxBefore = await fund.read.balanceOf([trader.account.address]);
    const bought = await buy(trader, 1_000n * USD);
    const received = (await fund.read.balanceOf([trader.account.address])) - ustxBefore;
    expectClose(received, quoted, quoted / 100_000n); // the fee grows a little each second
    expect(received < (10n * SHARE * 997n) / 1_000n && received > (10n * SHARE * 990n) / 1_000n).to.equal(true);
    const first = await swapFee(bought);
    expect(first.charged).to.equal(first.expected);
    expect(first.charged >= 3_000n && first.charged < 3_100n).to.equal(true);

    // The liquidity providers keep the fees: selling the USTX back leaves the pool worth about 0.3%
    // of each leg more at the NAV.
    await sell(trader, received);
    const roundTripGain = (await valueAt(NAV)) - valueBefore;
    expect(roundTripGain > 5_500_000n && roundTripGain < 6_500_000n).to.equal(true);

    // Half an hour on, the fee is 0.65%; at an hour it is 1.00%; past that swaps stop.
    const [, , , effectiveAt] = await registry.read.latestNav([USTX]);
    await time.setNextBlockTimestamp(effectiveAt + 1_800n);
    expect((await swapFee(await sell(trader, SHARE))).charged).to.equal(6_500n);
    await time.setNextBlockTimestamp(effectiveAt + HOUR);
    expect((await swapFee(await sell(trader, SHARE))).charged).to.equal(10_000n);
    await expectRevert(sell(trader, SHARE), "NavTooOld(uint256)");
    await expectRevert(hook.read.currentFee(), "NavTooOld(uint256)");
    await expectRevert(router.simulate.quoteExactInput([key, !buyUstx, SHARE], { account: trader.account.address }), "NavTooOld(uint256)");
    expect(await dollar.read.balanceOf([hook.address])).to.equal(0n); // the hook holds claims, not tokens
  });

  it("buys an exact output through the router, within the trader's limits and deadline", async () => {
    const { router, lp, trader, key, buyUstx, fund, dollar, prepare, seed } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(trader);
    await seed(lp);
    const quotedIn = (await router.simulate.quoteExactOutput([key, buyUstx, 5n * SHARE], { account: trader.account.address })).result;
    expect(quotedIn > 500n * USD && quotedIn < 505n * USD).to.equal(true);
    await expectRevert(router.write.swapExactOutput([key, buyUstx, 5n * SHARE, quotedIn / 2n, await deadline()], { account: trader.account }), "SlippageExceeded");
    await expectRevert(router.write.swapExactOutput([key, buyUstx, 5n * SHARE, maxUint256, BigInt(await time.latest())], { account: trader.account }), "Expired");
    await expectRevert(router.write.swapExactInput([key, buyUstx, 0n, 0n, await deadline()], { account: trader.account }), "InvalidAmount");
    const dollarsBefore = await dollar.read.balanceOf([trader.account.address]);
    await router.write.swapExactOutput([key, buyUstx, 5n * SHARE, (quotedIn * 1_001n) / 1_000n, await deadline()], { account: trader.account });
    expect(await fund.read.balanceOf([trader.account.address])).to.equal(5n * SHARE);
    expectClose(dollarsBefore - (await dollar.read.balanceOf([trader.account.address])), quotedIn, quotedIn / 100_000n);
    await expectRevert(router.write.swapExactInput([key, !buyUstx, SHARE, 1_000n * USD, await deadline()], { account: trader.account }), "SlippageExceeded");
    await expectRevert(router.write.unlockCallback(["0x"], { account: trader.account }), "NotPoolManager");
  });

  it("follows a new NAV record without arbitrage against liquidity providers, unlike a constant-product pool", async () => {
    const ctx = await deploy();
    const { hook, router, lp, lp2, trader, keeper, fund, dollar, key, buyUstx, prepare, seed, publish, slot0, expectedSqrt, valueAt, events } = ctx;
    // The same $10,000 at a $100 NAV in the hooked pool and in GanymedeUstxPool.
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 5_000n * USD);
    await prepare(trader);
    await seed(lp);
    const v2 = await hre.viem.deployContract("GanymedeUstxPool", [fund.address]);
    const arbitrage = await hre.viem.deployContract("GanymedeNavArbitrage", [v2.address]);
    await dollar.write.approve([v2.address, maxUint256], { account: lp2.account });
    await fund.write.approve([v2.address, maxUint256], { account: lp2.account });
    await v2.write.addLiquidity([50n * SHARE, 5_000n * USD, 0n, 0n, maxUint256], { account: lp2.account });
    await dollar.write.approve([arbitrage.address, maxUint256], { account: trader.account });

    // The NAV is recorded 5% higher.
    await publish(105n * USD);
    const v2Value = async () => {
      const [shares, dollars] = await v2.read.getReserves();
      return (shares * 105n * USD) / SHARE + dollars;
    };
    const v2Before = await v2Value();
    const hookBefore = await valueAt(105n * USD);

    // Constant product: an arbitrageur buys the cheap USTX from the pool and redeems it at the fund.
    const [buyInPool, dollarsIn] = await arbitrage.read.quote();
    expect(buyInPool).to.equal(true);
    const dollarsBefore = await dollar.read.balanceOf([trader.account.address]);
    await arbitrage.write.buyAndRedeem([dollarsIn, 0n], { account: trader.account });
    const profit = (await dollar.read.balanceOf([trader.account.address])) - dollarsBefore;
    const v2Loss = v2Before - (await v2Value());
    // About $2.69 on $10,000: the arbitrageur's profit is exactly what the liquidity providers lose.
    expect(profit > 2n * USD).to.equal(true);
    expect(v2Loss).to.equal(profit);

    // The hooked pool: the next swap, or a keeper, moves the empty pool to the new NAV first.
    const logs = await events(await hook.write.repeg({ account: keeper.account }));
    const repegged = logs.find(event => event.eventName === "Repegged")!.args as { navAnswer: bigint; navUpdatedAt: bigint };
    expect(repegged.navAnswer).to.equal(105n * USD * 100n);
    const move = logs.find(event => event.eventName === "Swap")!.args as { amount0: bigint; amount1: bigint; liquidity: bigint };
    expect([move.amount0, move.amount1, move.liquidity]).to.deep.equal([0n, 0n, 0n]); // nothing was exchanged
    expect((await slot0()).sqrtPriceX96).to.equal(expectedSqrt(105n * USD));
    expect(await hook.read.peggedAt()).to.equal(repegged.navUpdatedAt);
    const hookLoss = hookBefore - (await valueAt(105n * USD));
    expect(hookLoss < 1_000n).to.equal(true); // rounding: under a tenth of a cent

    // At the NAV plus a fee there is nothing left to arbitrage.
    const ustxOut = (await router.simulate.quoteExactInput([key, buyUstx, 1_000n * USD], { account: trader.account.address })).result;
    expect((ustxOut * 105n * USD) / SHARE < 1_000n * USD).to.equal(true);
  });

  it("still loses to a trade made before a known NAV record lands (the limit the fee bounds)", async () => {
    // The re-peg removes the jump when a record lands; until then the pool quotes the old NAV. Someone
    // who knows the next NAV from public prices can buy first and redeem at the fund after it lands.
    const { lp, trader, fund, dollar, prepare, seed, buy, publish, valueAt } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(trader);
    await seed(lp);
    const valueBefore = await valueAt(102n * USD);
    const dollarsBefore = await dollar.read.balanceOf([trader.account.address]);
    await buy(trader, 1_500n * USD);
    await publish(102n * USD);
    await fund.write.redeem([await fund.read.balanceOf([trader.account.address]), 0n], { account: trader.account });
    const profit = (await dollar.read.balanceOf([trader.account.address])) - dollarsBefore;
    const loss = valueBefore - (await valueAt(102n * USD));
    // With a $10,000 pool and a 2% record, $20.69: the fee and the curve take part of the move, not all of it.
    expect(profit > 20n * USD && profit < 21n * USD).to.equal(true);
    expectClose(loss, profit, 1_000n);
  });

  it("stops swaps once the NAV is an hour old and resumes at the next record", async () => {
    const { hook, lp, trader, keeper, prepare, seed, buy, sell, publish, poolNav, events } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(trader, 1_000n * USD);
    await seed(lp);
    await time.increase(HOUR + 1n);
    await expectRevert(buy(trader, 100n * USD), "NavTooOld(uint256)");
    await expectRevert(hook.write.repeg({ account: keeper.account }), "NavTooOld(uint256)");
    await expectRevert(hook.read.totalValue(), "NavTooOld(uint256)");
    // Deposits after the first need no NAV; they wait for the next record.
    const deposited = (await events(await seed(trader, SHARE, 100n * USD))).find(event => event.eventName === "Deposited");
    const { amount0, amount1 } = deposited!.args as { amount0: bigint; amount1: bigint };
    expect(amount0 > 0n && amount1 > 0n).to.equal(true);
    await publish(98n * USD);
    const logs = await events(await sell(trader, SHARE));
    expect(logs.some(event => event.eventName === "Repegged")).to.equal(true);
    expect(logs.some(event => event.eventName === "Converted")).to.equal(true);
    expect((await hook.read.claimableShares([trader.account.address])) > 0n).to.equal(true);
    const price = await poolNav();
    expect(price < 98n * USD && price > 97n * USD).to.equal(true); // the sale moved it down from the new NAV
  });

  it("refuses a NAV dated more than a minute after the block, which would not age", async () => {
    const { hook, lp, lp2, trader, keeper, registry, relayer, prepare, seed, buy, publish, swapFee } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(lp2, 1_000n * USD);
    await prepare(trader, 1_000n * USD);
    await seed(lp);
    // Clocks differ by a little: a record up to a minute ahead of its block is fresh, at the lowest fee.
    await time.increase(60);
    const ahead = BigInt(await time.latest()) + 45n;
    await registry.write.publishNav([USTX, 101n * USD, 0n, HOLDINGS, ahead], { account: relayer.account });
    expect((await hook.read.nav())[1]).to.equal(ahead);
    expect(await hook.read.currentFee()).to.equal(3_000);
    expect((await swapFee(await buy(trader, 10n * USD))).charged).to.equal(3_000n);
    const future = BigInt(await time.latest()) + 30n * 24n * HOUR;
    await publish(NAV, future);
    expect((await registry.read.latestNav([USTX]))[3]).to.equal(future);
    await expectRevert(hook.read.nav(), "NavInFuture(uint256)");
    await expectRevert(buy(trader, 100n * USD), "NavInFuture(uint256)");
    await expectRevert(hook.write.repeg({ account: keeper.account }), "NavInFuture(uint256)");
    // That record is already out: a deposit taken now would convert at it once the clock caught up,
    // a record its depositor could see. Deposits wait until it can be applied.
    await expectRevert(seed(lp2, SHARE, 100n * USD), "NavInFuture(uint256)");
    // Liquidity providers can still leave.
    const shares = await hook.read.balanceOf([lp.account.address]);
    await hook.write.withdraw([shares, 0n, 0n, await deadline()], { account: lp.account });
    expect(await hook.read.balanceOf([lp.account.address])).to.equal(0n);
  });

  it("refuses a swap that would take the price more than 5% from the NAV", async () => {
    const { lp, trader, prepare, seed, buy, sell, fund, router, key, buyUstx } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(trader, 8_000n * USD);
    await seed(lp);
    // The pool holds 50 USTX: buying more than that runs past its ranges.
    await expectRevert(buy(trader, 2_000n * USD * 3n), "OutsideBand(uint160)");
    await expectRevert(router.write.swapExactOutput([key, buyUstx, 51n * SHARE, maxUint256, await deadline()], { account: trader.account }), "OutsideBand(uint160)");
    await expectRevert(sell(trader, 70n * SHARE), "OutsideBand(uint160)");
    // Within the band both ways work.
    await buy(trader, 2_000n * USD);
    await sell(trader, 30n * SHARE);
    expect((await fund.read.balanceOf([trader.account.address])) > 0n).to.equal(true);
  });

  for (const assetFirst of [true, false]) {
    it(`places what the base range cannot use on the side where that token sells (USTX as currency${assetFirst ? 0 : 1})`, async () => {
      const { hook, lp, trader, assetIsCurrency0, prepare, seed, buy, sell, publish, slot0, split, liquidity } = await deploy({ assetFirst });
      await prepare(lp, 5_000n * USD);
      await prepare(trader, 7_000n * USD);
      // In the pool's terms currency0 sits above the price and currency1 below it; in dollar terms both
      // mean a bid for USTX below the NAV or an offer of USTX above it.
      const above = (center: number) => [center + 10, center + 310];
      const below = (center: number) => [center - 300, center];
      await seed(lp);
      const [, , fullBase] = await hook.read.baseRange();

      // After a $3,000 purchase the pool is long dollars: the base range is sized by its USTX, and
      // the dollars it cannot use bid for USTX just below the NAV.
      await buy(trader, 3_000n * USD);
      await publish(NAV);
      await sell(trader, SHARE / 100n); // the first swap after the record re-pegs
      let center = Math.floor((await slot0()).tick / 10) * 10;
      const [, , longDollarsBase] = await hook.read.baseRange();
      const [bidLower, bidUpper, bidLiquidity] = await hook.read.limitRange();
      expect(longDollarsBase < fullBase).to.equal(true);
      expect([bidLower, bidUpper]).to.deep.equal(assetIsCurrency0 ? below(center) : above(center));
      expect(bidLiquidity > 0n).to.equal(true);
      const held = split(await hook.read.totalAmounts());
      expect(held.dollars > (held.ustx * NAV) / SHARE).to.equal(true);

      // After heavy selling it is long USTX, which it offers just above the NAV.
      await sell(trader, 70n * SHARE);
      await publish(NAV);
      await buy(trader, USD);
      center = Math.floor((await slot0()).tick / 10) * 10;
      const [askLower, askUpper, askLiquidity] = await hook.read.limitRange();
      expect([askLower, askUpper]).to.deep.equal(assetIsCurrency0 ? above(center) : below(center));
      expect(askLiquidity > 0n).to.equal(true);
      // Neither one-sided range is in range at the NAV; the base range is.
      const [, , base] = await hook.read.baseRange();
      expect(await liquidity()).to.equal(base);
    });
  }

  it("lets only the hook add liquidity to its pool or open a pool with it", async () => {
    const { hook, manager, managerAddress, other, key, prepare, expectedSqrt, lp, seed } = await deploy();
    await prepare(other, 1_000n * USD);
    const helper = modifyLiquidityTestArtifact();
    const helperHash = await other.deployContract({ abi: helper.abi, bytecode: helper.bytecode, args: [managerAddress] });
    const publicClient = await hre.viem.getPublicClient();
    const helperAddress = (await publicClient.waitForTransactionReceipt({ hash: helperHash })).contractAddress!;
    const outsider = getContract({ address: helperAddress, abi: helper.abi, client: { public: publicClient, wallet: other } });
    const params = { tickLower: 45_000, tickUpper: 47_000, liquidityDelta: 10n ** 9n, salt: `0x${"00".repeat(32)}` as Hex };
    await expectRevert(outsider.write.modifyLiquidity([key, params, "0x"]), "LiquidityThroughHook");
    await expectRevert(manager.write.initialize([{ ...key, tickSpacing: 60 }, expectedSqrt(NAV)]), "PoolOpenedByHook");
    await expectRevert(manager.write.initialize([{ ...key, fee: 3_000 }, expectedSqrt(NAV)]), "PoolOpenedByHook");
    await expectRevert(manager.write.initialize([key, expectedSqrt(NAV)]), "PoolOpenedByHook"); // asked before the pool manager checks
    // The callbacks answer the pool manager only.
    const swapParams = { zeroForOne: true, amountSpecified: -1n, sqrtPriceLimitX96: 4295128740n };
    await expectRevert(hook.write.beforeSwap([other.account.address, key, swapParams, "0x"], { account: other.account }), "NotPoolManager");
    await expectRevert(hook.write.unlockCallback(["0x"], { account: other.account }), "NotPoolManager");
    await expectRevert(hook.read.afterDonate([other.account.address, key, 0n, 0n, "0x"]), "HookNotImplemented");
    // Removing liquidity from the hook's ranges is keyed to the hook: an outsider has none to remove.
    await prepare(lp, 5_000n * USD);
    await seed(lp);
    const [lower, upper] = await hook.read.baseRange();
    await expectRevert(
      outsider.write.modifyLiquidity([key, { tickLower: lower, tickUpper: upper, liquidityDelta: -1n, salt: params.salt }, "0x"]),
      "SafeCastOverflow",
    );
  });

  it("passes donations on to liquidity providers and ignores tokens sent to it", async () => {
    const { hook, lp, other, dollar, managerAddress, key, pair, split, prepare, seed } = await deploy();
    await prepare(lp, 5_000n * USD);
    await prepare(other);
    await seed(lp);
    const before = split(await hook.read.totalAmounts());
    await dollar.write.transfer([hook.address, 100n * USD], { account: other.account });
    expect(split(await hook.read.totalAmounts())).to.deep.equal(before);

    const donor = donateTestArtifact();
    const publicClient = await hre.viem.getPublicClient();
    const hash = await other.deployContract({ abi: donor.abi, bytecode: donor.bytecode, args: [managerAddress] });
    const donorAddress = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
    await dollar.write.approve([donorAddress, maxUint256], { account: other.account });
    const donation = getContract({ address: donorAddress, abi: donor.abi, client: { public: publicClient, wallet: other } });
    await donation.write.donate([key, ...pair(0n, 50n * USD), "0x"]);
    const after = split(await hook.read.totalAmounts());
    expect(after.ustx).to.equal(before.ustx);
    expectClose(after.dollars - before.dollars, 50n * USD, 1n);
    const shares = await hook.read.balanceOf([lp.account.address]);
    const [out0, out1] = await hook.read.previewWithdraw([shares]);
    const paid = split([out0, out1]);
    expect(paid.dollars > before.dollars + 49n * USD).to.equal(true);
  });

  it("moves LP shares like an ERC-20, and the new holder can withdraw", async () => {
    const { hook, lp, other, trader, prepare, seed } = await deploy();
    await prepare(lp, 5_000n * USD);
    await seed(lp);
    await expectRevert(hook.write.transfer([zeroAddress, 1n], { account: lp.account }), "InvalidAddress");
    // The hook's own balance holds converted deposits until they are claimed.
    await expectRevert(hook.write.transfer([hook.address, 1n], { account: lp.account }), "InvalidAddress");
    await expectRevert(hook.write.transfer([other.account.address, 10n ** 12n], { account: lp.account }), "InsufficientBalance");
    await hook.write.transfer([other.account.address, 1_000n * USD], { account: lp.account });
    await hook.write.approve([trader.account.address, 500n * USD], { account: other.account });
    await expectRevert(hook.write.transferFrom([other.account.address, trader.account.address, 501n * USD], { account: trader.account }), "InsufficientAllowance");
    await hook.write.transferFrom([other.account.address, trader.account.address, 500n * USD], { account: trader.account });
    expect(await hook.read.allowance([other.account.address, trader.account.address])).to.equal(0n);
    expect(await hook.read.balanceOf([trader.account.address])).to.equal(500n * USD);
    await hook.write.withdraw([500n * USD, 0n, 0n, await deadline()], { account: trader.account });
    expect(await hook.read.balanceOf([trader.account.address])).to.equal(0n);
  });

  it("runs the same with USTX as the pool's second currency", async () => {
    const { hook, lp, trader, keeper, assetIsCurrency0, slot0, poolNav, expectedSqrt, prepare, seed, buy, sell, publish, valueAt } = await deploy({ assetFirst: false });
    expect(assetIsCurrency0).to.equal(false);
    // The pool prices USTX in dollars the other way up: a price below one and a negative tick.
    const opened = await slot0();
    expect(opened.sqrtPriceX96).to.equal(expectedSqrt(NAV));
    expect(opened.tick < 0).to.equal(true);
    expectClose(await poolNav(), NAV, 1n);
    await prepare(lp, 5_000n * USD);
    await prepare(trader, 1_000n * USD);
    await seed(lp);
    const [baseLower, baseUpper] = await hook.read.baseRange();
    const center = Math.floor(opened.tick / 10) * 10;
    expect([baseLower, baseUpper]).to.deep.equal([center - 200, center + 210]);
    await buy(trader, 500n * USD);
    expect((await poolNav()) > NAV).to.equal(true);
    await sell(trader, 2n * SHARE);
    await publish(103n * USD);
    const before = await valueAt(103n * USD);
    await hook.write.repeg({ account: keeper.account });
    expect((await slot0()).sqrtPriceX96).to.equal(expectedSqrt(103n * USD));
    expect(before - (await valueAt(103n * USD)) < 1_000n).to.equal(true);
    await hook.write.withdraw([await hook.read.balanceOf([lp.account.address]), 0n, 0n, await deadline()], { account: lp.account });
    expect(await hook.read.totalSupply()).to.equal(1_000n);
  });

  it("re-pegs to a NAV that lands exactly on a tick, like a $1.00 treasury token", async () => {
    // A NAV of $1.00 is exactly tick 0. Moving the empty pool down onto it leaves the pool manager's
    // tick at -1, the case where it treats a range ending at the price as in range.
    const { hook, lp, trader, keeper, slot0, expectedSqrt, prepare, seed, buy, sell, publish, valueAt, split } = await deploy({ assetFirst: true, nav: 1_050_000n });
    await prepare(lp, 5_000n * USD);
    await prepare(trader, 2_000n * USD);
    const ustx = 4_000n * SHARE;
    await seed(lp, ustx, 4_200n * USD);
    await buy(trader, 1_500n * USD);
    await publish(1n * USD);
    const before = await valueAt(1n * USD);
    await hook.write.repeg({ account: keeper.account });
    const { sqrtPriceX96, tick } = await slot0();
    expect(sqrtPriceX96).to.equal(expectedSqrt(1n * USD));
    expect(sqrtPriceX96).to.equal(1n << 96n);
    expect(tick).to.equal(-1);
    const [bidLower, bidUpper] = await hook.read.limitRange();
    expect([bidLower, bidUpper]).to.deep.equal([-300, 0]);
    expect(before - (await valueAt(1n * USD)) < 100n).to.equal(true);
    // Trading and exits work from there; the preview matches what a withdrawal pays.
    await sell(trader, 100n * SHARE);
    await buy(trader, 100n * USD);
    const shares = await hook.read.balanceOf([lp.account.address]);
    const preview = await hook.read.previewWithdraw([shares]);
    await hook.write.withdraw([shares, preview[0], preview[1], await deadline()], { account: lp.account });
    const left = split(await hook.read.totalAmounts());
    expect(left.ustx + left.dollars < 2_000n).to.equal(true);
  });

  it("refuses a partial fill on a pool that runs out of liquidity", async () => {
    const { router, manager, managerAddress, trader, other, fund, dollar, prepare } = await deploy();
    await prepare(other, 5_000n * USD);
    await prepare(trader);
    // A plain pool without a hook, with liquidity in one narrow range.
    const [currency0, currency1] = BigInt(fund.address) < BigInt(dollar.address) ? [fund.address, dollar.address] : [dollar.address, fund.address];
    const plain = { currency0: getAddress(currency0), currency1: getAddress(currency1), fee: 3_000, tickSpacing: 60, hooks: zeroAddress };
    await manager.write.initialize([plain, 1n << 96n]);
    const helper = modifyLiquidityTestArtifact();
    const publicClient = await hre.viem.getPublicClient();
    const hash = await other.deployContract({ abi: helper.abi, bytecode: helper.bytecode, args: [managerAddress] });
    const helperAddress = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
    await dollar.write.approve([helperAddress, maxUint256], { account: other.account });
    await fund.write.approve([helperAddress, maxUint256], { account: other.account });
    const provider = getContract({ address: helperAddress, abi: helper.abi, client: { public: publicClient, wallet: other } });
    await provider.write.modifyLiquidity([plain, { tickLower: -60, tickUpper: 60, liquidityDelta: 10n ** 8n, salt: `0x${"00".repeat(32)}` as Hex }, "0x"]);
    const dollarIsCurrency0 = getAddress(currency0) === getAddress(dollar.address);
    await expectRevert(router.write.swapExactInput([plain, dollarIsCurrency0, 1_000n * USD, 0n, await deadline()], { account: trader.account }), "PartialFill");
    await router.write.swapExactInput([plain, dollarIsCurrency0, 100_000n, 0n, await deadline()], { account: trader.account });
  });

  it("keeps its books across a long random run of deposits, trades, records and withdrawals", async () => {
    const { hook, manager, publicClient, lp, lp2, other, trader, keeper, fund, dollar, key, split, prepare, seed, buy, sell, publish } = await deploy();
    // A small deterministic generator, so a failure replays.
    let state = 0x2545f491n;
    const random = (below: bigint) => {
      state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return (state >> 33n) % below;
    };
    const providers = [lp, lp2, other];
    for (const wallet of providers) await prepare(wallet, 4_000n * USD);
    await prepare(trader, 5_000n * USD);
    await seed(lp, 40n * SHARE, 4_000n * USD);
    const claims = async (currency: Address) => manager.read.balanceOf([hook.address, BigInt(currency)]) as Promise<bigint>;
    const owned = async (holder: Address) => (await hook.read.balanceOf([holder])) + (await hook.read.claimableShares([holder]));
    const counts = { deposits: 1, cancels: 0, withdrawals: 0, swaps: 0, repegs: 0, refused: 0 };
    let nav = NAV;
    for (let step = 0; step < 140; step++) {
      const action = random(7n);
      const wallet = providers[Number(random(3n))];
      try {
        if (action === 0n) {
          await seed(wallet, random(20n) * SHARE + 1n, random(2_000n) * USD + 1n);
          counts.deposits++;
        } else if (action === 1n) {
          const shares = await owned(wallet.account.address);
          if (shares > 0n) {
            await hook.write.withdraw([(shares * (random(100n) + 1n)) / 100n, 0n, 0n, await deadline()], { account: wallet.account });
            counts.withdrawals++;
          }
        } else if (action === 2n) {
          await buy(trader, random(1_500n) * USD + USD);
          counts.swaps++;
        } else if (action === 3n) {
          await sell(trader, random(15n) * SHARE + SHARE / 10n);
          counts.swaps++;
        } else if (action === 4n) {
          nav = (nav * (10_000n + random(400n) - 200n)) / 10_000n; // within ±2%
          await publish(nav);
        } else if (action === 5n) {
          if ((await hook.simulate.repeg({ account: keeper.account.address })).result) {
            await hook.write.repeg({ account: keeper.account });
            counts.repegs++;
          }
        } else {
          const [waiting0, waiting1, waitingEpoch] = await hook.read.pendingOf([wallet.account.address]);
          if (waiting0 + waiting1 > 0n && waitingEpoch === (await hook.read.epoch())) {
            await hook.write.cancelDeposit({ account: wallet.account });
            counts.cancels++;
          }
        }
      } catch (error) {
        // A trade the band refuses, or a deposit too small to take anything, is an allowed outcome.
        const text = revertText(error);
        const allowed = text.toLowerCase().includes(selector("OutsideBand(uint160)")) || /\bInvalidAmount\b/.test(text);
        if (!allowed) throw error;
        counts.refused++;
      }
      // The claims the hook holds are exactly its idle balances, which cover the waiting deposits;
      // the waiting deposits add up; and every holder could leave with their shares.
      const [idle0, idle1, pending0, pending1, currentEpoch] = await Promise.all([
        hook.read.idle0(),
        hook.read.idle1(),
        hook.read.pending0(),
        hook.read.pending1(),
        hook.read.epoch(),
      ]);
      expect(await claims(key.currency0)).to.equal(idle0);
      expect(await claims(key.currency1)).to.equal(idle1);
      expect(idle0 >= pending0 && idle1 >= pending1).to.equal(true);
      const [held0, held1] = await hook.read.totalAmounts();
      let owed0 = 0n;
      let owed1 = 0n;
      let waitingSum0 = 0n;
      let waitingSum1 = 0n;
      let claimable = 0n;
      for (const holder of providers) {
        const [waiting0, waiting1, waitingEpoch] = await hook.read.pendingOf([holder.account.address]);
        if (waitingEpoch === currentEpoch) {
          waitingSum0 += waiting0;
          waitingSum1 += waiting1;
        }
        claimable += await hook.read.claimableShares([holder.account.address]);
        const shares = await owned(holder.account.address);
        if (shares === 0n) continue;
        const [out0, out1] = await hook.read.previewWithdraw([shares]);
        owed0 += out0;
        owed1 += out1;
      }
      expect([waitingSum0, waitingSum1]).to.deep.equal([pending0, pending1]);
      expect(claimable <= (await hook.read.balanceOf([hook.address]))).to.equal(true);
      expect(owed0 <= held0 && owed1 <= held1).to.equal(true);
    }
    const records = await publicClient.getContractEvents({ address: hook.address, abi: hook.abi, eventName: "Repegged", fromBlock: 0n });
    const conversions = await publicClient.getContractEvents({ address: hook.address, abi: hook.abi, eventName: "Converted", fromBlock: 0n });
    expect(counts.deposits > 10 && counts.cancels > 0 && counts.withdrawals > 5 && counts.swaps > 30).to.equal(true);
    expect(counts.repegs > 0 && records.length > 10 && conversions.length > 3 && counts.refused < 20).to.equal(true);

    // Everyone leaves; what stays belongs to the locked shares, or is claim rounding, and is dust.
    for (const holder of providers) {
      const [waiting0, waiting1, waitingEpoch] = await hook.read.pendingOf([holder.account.address]);
      if (waiting0 + waiting1 > 0n && waitingEpoch === (await hook.read.epoch())) await hook.write.cancelDeposit({ account: holder.account });
      const shares = await owned(holder.account.address);
      if (shares > 0n) await hook.write.withdraw([shares, 0n, 0n, await deadline()], { account: holder.account });
    }
    const unclaimed = await hook.read.balanceOf([hook.address]);
    expect(unclaimed < 100n).to.equal(true);
    expect(await hook.read.totalSupply()).to.equal(1_000n + unclaimed);
    expect([await hook.read.pending0(), await hook.read.pending1()]).to.deep.equal([0n, 0n]);
    const left = split(await hook.read.totalAmounts());
    expect((left.ustx * nav) / SHARE + left.dollars < 100_000n).to.equal(true); // under 10 cents
    expect(await claims(key.currency0)).to.equal(await hook.read.idle0());
    expect((await fund.read.balanceOf([hook.address])) + (await dollar.read.balanceOf([hook.address]))).to.equal(0n);
  });


  it("never lets trades take value from its providers at the NAV, across random NAV paths and orders", async () => {
    // HOOK_FUZZ_SEEDS and HOOK_FUZZ_STEPS run it longer; each seed replays.
    const seeds = Number(process.env.HOOK_FUZZ_SEEDS ?? 3);
    const steps = Number(process.env.HOOK_FUZZ_STEPS ?? 40);
    const { hook, lp, lp2, trader, keeper, managerAddress, poolId, assetIsCurrency0, fund, dollar, split, prepare, seed, buy, sell, publish, valueAt, receipt } = await deploy();
    await prepare(lp, 4_000n * USD);
    await prepare(lp2, 2_000n * USD);
    await prepare(trader, 6_000n * USD);
    await seed(lp, 40n * SHARE, 4_000n * USD);
    // What the app counts for the providers (lib/xstocks/lp-markout.ts), over this pool's events.
    const deployment = {
      poolManager: managerAddress.toLowerCase(), hook: hook.address.toLowerCase(), router: "", asset: fund.address.toLowerCase(), dollar: dollar.address.toLowerCase(),
      assetIsCurrency0, poolId: poolId.toLowerCase(), stateSlot: "",
    };
    const none = { trades: 0, volumeMicros: 0n, resultMicros: 0n, arbitrages: 0, arbitrageResultMicros: 0n };
    const traderHolds = async () => [await fund.read.balanceOf([trader.account.address]), await dollar.read.balanceOf([trader.account.address])] as const;
    let nav = NAV;
    // Everything the providers own, waiting deposits included, valued at the NAV in effect. Moving
    // the pool to a new record changes none of it, so it is the baseline the trades after that record
    // are measured from: liquidity is worth least at the NAV when the pool's price is at the NAV, and
    // every trade away from it, and its fee, can only add.
    const value = async () => {
      const waiting = split([await hook.read.pending0(), await hook.read.pending1()]);
      return (await valueAt(nav)) + (waiting.ustx * nav) / SHARE + waiting.dollars;
    };
    let baseline = await value();
    let counted = 0n;
    let swaps = 0;
    let refused = 0;
    let records = 0;
    for (let run = 0; run < seeds; run++) {
      let state = 0x9e3779b97f4a7c15n + BigInt(run);
      const random = (below: bigint) => {
        state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
        return (state >> 33n) % below;
      };
      for (let step = 0; step < steps; step++) {
        // A record up to 3% either way, often none; a keeper's re-peg now and then; a deposit rarely.
        if (random(3n) === 0n) {
          nav = (nav * (10_000n + random(600n) - 300n)) / 10_000n;
          await publish(nav);
          baseline = await value();
          counted = 0n;
          records++;
        }
        if (random(3n) === 0n) await hook.write.repeg({ account: keeper.account }).catch(() => undefined);
        if (random(8n) === 0n) {
          const before = await value();
          await seed(lp2, random(5n) * SHARE + 1n, random(500n) * USD + 1n).catch(() => undefined);
          baseline += (await value()) - before;
        }
        const before = await value();
        const [sharesBefore, dollarsBefore] = await traderHolds();
        const size = random(4n) + 1n; // up to about 4% of the pool
        try {
          // Within what the trader holds: an order it cannot pay for goes the other way.
          const dollars = size * 100n * USD + random(USD);
          const shares = size * SHARE + random(SHARE);
          const buying = random(2n) === 0n ? dollarsBefore >= dollars : sharesBefore < shares;
          const hash = buying ? await buy(trader, dollars) : await sell(trader, shares);
          const after = await value();
          const { logs, blockNumber } = await receipt(hash);
          const start: LpMarkout = { fromBlock: 0, fromTime: 0, toBlock: 0, toTime: 0, navMicros: nav, navRecords: 0, repegs: 0, constantProduct: none, v4: none };
          const trade = applyEvents(start, logs.map(log => ({
            address: log.address.toLowerCase(), topics: log.topics.map(topic => topic.toLowerCase()), data: log.data.toLowerCase(),
            block: Number(blockNumber), logIndex: log.logIndex, hash: log.transactionHash.toLowerCase(),
          })), deployment).v4;
          // The app counts exactly what the trader gave up at the NAV, to a micro of rounding, and,
          // within the rounding of valuing liquidity, what the providers' holdings gained.
          const [sharesAfter, dollarsAfter] = await traderHolds();
          expect(trade.trades).to.equal(1);
          expectClose(trade.resultMicros, (dollarsBefore - dollarsAfter) - ((sharesAfter - sharesBefore) * nav) / SHARE, 2n);
          expectClose(trade.resultMicros, after - before, 1_000n);
          counted += trade.resultMicros;
          swaps++;
        } catch (error) {
          // A trade that would move the price more than 5% from the NAV is refused, not filled.
          if (!revertText(error).toLowerCase().includes(selector("OutsideBand(uint160)"))) throw error;
          refused++;
        }
        // Since the last record, the trades have cost the providers nothing at the NAV: what they
        // own has not fallen, and what the app counted for them adds up to no loss.
        const now = await value();
        expect(now - baseline >= -2_000n, `seed ${run} step ${step}: providers are ${baseline - now} micros down since the record`).to.equal(true);
        expect(counted >= -2_000n, `seed ${run} step ${step}: the app counted ${counted} micros since the record`).to.equal(true);
      }
    }
    expect(swaps > (seeds * steps) / 2 && records > seeds * 5, `${swaps} swaps, ${refused} refused, ${records} records`).to.equal(true);
  }).timeout(0); // its length follows HOOK_FUZZ_SEEDS and HOOK_FUZZ_STEPS
});
