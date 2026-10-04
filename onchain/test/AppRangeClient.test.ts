import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, keccak256, maxUint256, toBytes, toEventSelector, toFunctionSelector, type AbiItem, type Address, type Hex } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";
import { type FundReceipt } from "../../lib/xstocks/fund";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RANGE_ERRORS, RANGE_EVENTS, RANGE_POOL_DEPLOYMENT, RANGE_SELECTORS, rangeCalls, rangeErrorMessage, rangeFill, readRangePool, type RangeDeployment } from "../../lib/xstocks/range-liquidity";
import { binTicksFor, planRange } from "../../lib/xstocks/lp-strategy";
import { CREATE2_PROXY, CREATE2_PROXY_CODE, DYNAMIC_FEE_FLAG, deployRangeLiquidity, deployRwaLiquidity, poolIdOf, poolStateSlot } from "../scripts/_v4";

// lib/xstocks/range-liquidity.ts hard-codes the range hook's selectors, events and errors. These
// checks tie them to the compiled hook and run the app's own calldata and reads against a local
// PoolManager and range hook: open a Bid-Ask position, read it back, close it.

const USD = 1_000_000n;
const USTX = productKey("us-tech-x");
const signature = (item: { name: string; inputs: readonly { type: string }[] }) => `${item.name}(${item.inputs.map(input => input.type).join(",")})`;
const appRpc = (method: string, params: unknown[]) => method === "eth_chainId" ? Promise.resolve("0x7a0") : hre.network.provider.request({ method, params });

describe("App range pool client", () => {
  it("uses the selectors, events and errors of the compiled range hook", async () => {
    const hook = (await hre.artifacts.readArtifact("GanymedeRangeLiquidityHook")).abi as readonly AbiItem[];
    const manager = ["function extsload(bytes32)"];
    const functions = new Set([...hook.filter(item => item.type === "function").map(item => toFunctionSelector(item as never)), toFunctionSelector(manager[0])]);
    for (const [name, selector] of Object.entries(RANGE_SELECTORS)) expect(functions.has(selector), name).to.equal(true);
    const eventOf = (name: string) => toEventSelector(signature(hook.find(item => item.type === "event" && item.name === name) as never));
    expect(RANGE_EVENTS).to.deep.equal({ opened: eventOf("PositionOpened"), closed: eventOf("PositionClosed") });
    const errors = new Set(hook.filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(RANGE_ERRORS)) expect(errors.has(selector), selector).to.equal(true);
  });

  it("opens, reads and closes a Bid-Ask position with the app's own calls", async () => {
    const [admin, relayer, provider] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([fund.address]);
    const feed = await hre.viem.deployContract("GanymedeNavFeed", [registry.address, USTX, "USTX / USD"]);
    await time.increase(60);
    await registry.write.publishNav([USTX, 100n * USD, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    await hre.network.provider.request({ method: "hardhat_setCode", params: [CREATE2_PROXY, CREATE2_PROXY_CODE] });
    const read = async (name: string) => { const artifact = await hre.artifacts.readArtifact(name); return { abi: artifact.abi, bytecode: artifact.bytecode as Hex }; };
    const base = await deployRwaLiquidity({
      wallet: admin, publicClient, hookArtifact: await read("GanymedeRwaLiquidityHook"), routerArtifact: await read("GanymedeV4Router"),
      asset: fund.address, dollar: dollar.address, feed: feed.address, name: "Ganymede USTX-dUSD v4 LP", symbol: "USTX-V4LP",
    });
    const range = await deployRangeLiquidity({
      wallet: admin, publicClient, hookArtifact: await read("GanymedeRangeLiquidityHook"), arbitrageArtifact: await read("GanymedeRangeArbitrage"),
      poolManager: base.poolManager.address, asset: fund.address, dollar: dollar.address, feed: feed.address,
    });
    const assetIsCurrency0 = BigInt(fund.address) < BigInt(dollar.address);
    const poolId = poolIdOf({
      currency0: getAddress(assetIsCurrency0 ? fund.address : dollar.address), currency1: getAddress(assetIsCurrency0 ? dollar.address : fund.address),
      fee: DYNAMIC_FEE_FLAG, tickSpacing: 10, hooks: getAddress(range.hook.address),
    });
    // What `npm run deploy:range` records and the app pins.
    const deployment: RangeDeployment = {
      poolManager: base.poolManager.address.toLowerCase(), hook: range.hook.address.toLowerCase(), router: base.router.address.toLowerCase(),
      asset: fund.address.toLowerCase(), dollar: dollar.address.toLowerCase(), assetIsCurrency0, poolId: poolId.toLowerCase(), stateSlot: poolStateSlot(poolId),
      arbitrage: range.arbitrage.address.toLowerCase(),
    };
    const send = async (request: { to: string; data: string }) => {
      const hash = await provider.sendTransaction({ to: request.to as Address, data: request.data as Hex });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    const deadline = async () => Number(await time.latest()) + 600;

    // As the one button does it: half the deposit buys USTX at the NAV, the other half fills the bins below.
    await dollar.write.claim({ account: provider.account });
    await dollar.write.approve([fund.address, maxUint256], { account: provider.account });
    const plan = planRange(1_000n * USD, 100n * USD, "both")!;
    await fund.write.invest([plan.investMicros, 0n], { account: provider.account });
    const calls = rangeCalls(deployment);
    await send(calls.approveDollars(plan.dollarsMicros));
    await send(calls.approveShares(plan.sharesMicros));

    let { pool, account } = await readRangePool(deployment, provider.account.address, { rpc: appRpc });
    expect(pool.navMicros).to.equal(100n * USD);
    expect(pool.priceMicros > 99_990_000n && pool.priceMicros < 100_010_000n, `price ${pool.priceMicros}`).to.equal(true);
    expect(account!.positions).to.deep.equal([]);
    expect(account!.dollarAllowanceMicros).to.equal(plan.dollarsMicros);

    const opened = rangeFill(await send(calls.open("bid-ask", binTicksFor(3, 10), 10, 10, { sharesMicros: plan.sharesMicros, dollarsMicros: plan.dollarsMicros }, await deadline())), deployment, provider.account.address);
    expect(opened.opened?.id).to.equal(1n);
    expect(opened.opened!.amounts.sharesMicros <= plan.sharesMicros && opened.opened!.amounts.sharesMicros > plan.sharesMicros - 30n).to.equal(true);
    expect(opened.opened!.amounts.dollarsMicros <= plan.dollarsMicros && opened.opened!.amounts.dollarsMicros > plan.dollarsMicros - 30n).to.equal(true);

    ({ pool, account } = await readRangePool(deployment, provider.account.address, { rpc: appRpc }));
    const [position] = account!.positions;
    expect(position).to.include({ id: 1n, shape: "bid-ask", binTicks: 30, binsBelow: 10, binsAbove: 10, open: true });
    expect(position.bins.length).to.equal(20);
    // Heaviest at the ends: the farthest bins hold ten times the nearest.
    expect(Number(position.bins[0].liquidity) / Number(position.bins[9].liquidity)).to.be.closeTo(10, 0.5);
    expect(position.bins[0].fromUsd < 97.1 && position.bins[19].toUsd > 102.9, `${position.bins[0].fromUsd}–${position.bins[19].toUsd}`).to.equal(true);
    expect(position.amounts.sharesMicros + 30n >= opened.opened!.amounts.sharesMicros).to.equal(true);

    // Another wallet's close is refused, in words; the owner's pays tokens back.
    try {
      await admin.sendTransaction({ to: deployment.hook as Address, data: calls.close(1n, { sharesMicros: 0n, dollarsMicros: 0n }, await deadline()).data as Hex });
      expect.fail("closed another wallet's position");
    } catch (error) {
      expect(rangeErrorMessage(error)).to.equal("That position belongs to another wallet.");
    }
    const closed = rangeFill(await send(calls.close(1n, { sharesMicros: position.amounts.sharesMicros * 99n / 100n, dollarsMicros: position.amounts.dollarsMicros * 99n / 100n }, await deadline())), deployment, provider.account.address);
    expect(closed.closed?.id).to.equal(1n);
    expect(closed.closed!.amounts.sharesMicros + 2n >= position.amounts.sharesMicros).to.equal(true);
    expect((await readRangePool(deployment, provider.account.address, { rpc: appRpc })).account!.positions).to.deep.equal([]);
  });

  it("points at the recorded deployment", () => {
    const record = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "xlayer-testnet.json"), "utf8"));
    const { GanymedeRangeLiquidityHook: hook, GanymedeRangeArbitrage: arbitrage, UniswapV4PoolManager: manager, GanymedeV4Router: router, GanymedeBasketFund: fund, GanymedeDemoDollar: dollar } = record.contracts;
    const pin = RANGE_POOL_DEPLOYMENT!;
    expect(pin.hook).to.equal(hook.address.toLowerCase());
    expect(pin.arbitrage).to.equal(arbitrage.address.toLowerCase());
    expect(pin.poolManager).to.equal(manager.address.toLowerCase());
    expect(pin.router).to.equal(router.address.toLowerCase());
    expect(pin.asset).to.equal(fund.address.toLowerCase());
    expect(pin.dollar).to.equal(dollar.address.toLowerCase());
    expect(pin.poolId).to.equal(hook.poolId.toLowerCase());
    expect(pin.stateSlot).to.equal(poolStateSlot(hook.poolId));
    expect(pin.assetIsCurrency0).to.equal(BigInt(fund.address) < BigInt(dollar.address));
    expect(hook.seedTransaction).to.match(/^0x[0-9a-f]{64}$/);
  });
});
