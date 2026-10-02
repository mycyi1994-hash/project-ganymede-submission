import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, keccak256, maxUint256, toBytes, toEventSelector, toFunctionSelector, zeroAddress, type AbiItem, type Address } from "viem";
import {
  FUND_DEPLOYMENT, FUND_ERRORS, FUND_EVENTS, FUND_SELECTORS, POOL_EVENTS, POOL_SELECTORS, dollarsFor, fundCalls, poolAmountOut, poolCalls, poolFill, routeOrder, withSlippage,
  type FundReceipt,
} from "../../lib/xstocks/fund";
import { LENDING_ALL, LENDING_ERRORS, LENDING_EVENTS, LENDING_SELECTORS, LENDING_TERMS, lendingCalls, lendingFill, lendingPosition } from "../../lib/xstocks/lending";
import {
  LIQUIDITY_ERRORS, LIQUIDITY_EVENTS, LIQUIDITY_SELECTORS, POOL_MINIMUM_LIQUIDITY, invariantPerLp, liquidityCalls, liquidityFill, pairedDollars, pairedShares,
  quoteAddLiquidity, quoteRemoveLiquidity, splitDollarsOnly,
} from "../../lib/xstocks/liquidity";
import { ACTIVITY_EVENTS, activityCounts, scanActivity } from "../../lib/xstocks/activity";
import { productKey, toBytes32 } from "../../relayer/src/ids";

// The app carries no keccak, so lib/xstocks/fund.ts hard-codes selectors and addresses.
// These checks tie them to the compiled contracts and to the deployment record.

const signature = (item: { name: string; inputs: readonly { type: string }[] }) => `${item.name}(${item.inputs.map(input => input.type).join(",")})`;
/** The app's RPC shape, answered by the Hardhat network. */
const localRpc = (method: string, params: unknown[]) => hre.network.provider.request({ method, params });

async function abis() {
  const [fund, dollar] = await Promise.all([hre.artifacts.readArtifact("GanymedeBasketFund"), hre.artifacts.readArtifact("GanymedeDemoDollar")]);
  return { fund: fund.abi as readonly AbiItem[], dollar: dollar.abi as readonly AbiItem[] };
}

describe("App fund client", () => {
  it("uses the selectors of the compiled contracts", async () => {
    const { fund, dollar } = await abis();
    const selectors = new Set([...fund, ...dollar].filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(FUND_SELECTORS)) expect(selectors.has(selector), name).to.equal(true);
    expect(FUND_SELECTORS.invest).to.equal(toFunctionSelector("invest(uint256,uint256)"));
    expect(FUND_SELECTORS.redeem).to.equal(toFunctionSelector("redeem(uint256,uint256)"));
    expect(FUND_SELECTORS.approve).to.equal(toFunctionSelector("approve(address,uint256)"));
    const pool = (await hre.artifacts.readArtifact("GanymedeUstxPool")).abi as readonly AbiItem[];
    const poolSelectors = new Set(pool.filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(POOL_SELECTORS)) expect(poolSelectors.has(selector), name).to.equal(true);
  });

  it("decodes the fund's and the pool's events and errors", async () => {
    const { fund, dollar } = await abis();
    const pool = (await hre.artifacts.readArtifact("GanymedeUstxPool")).abi as readonly AbiItem[];
    const events = [...fund, ...pool].filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const topic = (name: string) => toEventSelector(signature(events.find(item => item.name === name)!));
    expect(FUND_EVENTS.invested).to.equal(topic("Invested"));
    expect(FUND_EVENTS.redeemed).to.equal(topic("Redeemed"));
    expect(POOL_EVENTS.bought).to.equal(topic("Bought"));
    expect(POOL_EVENTS.sold).to.equal(topic("Sold"));
    const arbitrage = (await hre.artifacts.readArtifact("GanymedeNavArbitrage")).abi as readonly AbiItem[];
    const lending = (await hre.artifacts.readArtifact("GanymedeLendingMarket")).abi as readonly AbiItem[];
    const eventOf = (abi: readonly AbiItem[], name: string) => toEventSelector(signature(abi.find(item => item.type === "event" && item.name === name) as never));
    expect(ACTIVITY_EVENTS).to.deep.equal({
      arbitraged: eventOf(arbitrage, "Arbitraged"), liquidityAdded: eventOf(pool, "LiquidityAdded"),
      liquidityRemoved: eventOf(pool, "LiquidityRemoved"), liquidated: eventOf(lending, "Liquidated"),
    });
    expect(POOL_SELECTORS.buy).to.equal(toFunctionSelector("buy(uint256,uint256,uint256)"));
    expect(POOL_SELECTORS.sell).to.equal(toFunctionSelector("sell(uint256,uint256,uint256)"));

    const errors = new Set([...fund, ...dollar, ...pool].filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(FUND_ERRORS)) expect(errors.has(selector), selector).to.equal(true);
  });

  it("quotes, routes, encodes and reads pool orders exactly as the pool contract does", async () => {
    const USD = 1_000_000n;
    const USTX = productKey("us-tech-x");
    const [admin, relayer, trader] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const firstBlock = Number(await publicClient.getBlockNumber()) + 1;
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([fund.address]);
    // The app's calldata names the deployed pool, so this pool's code (its immutables name the local
    // fund and dollar) runs at that address.
    const local = await hre.viem.deployContract("GanymedeUstxPool", [fund.address]);
    await hre.network.provider.request({ method: "hardhat_setCode", params: [FUND_DEPLOYMENT.pool, await publicClient.getCode({ address: local.address })] });
    const pool = await hre.viem.getContractAt("GanymedeUstxPool", FUND_DEPLOYMENT.pool as Address);
    await time.increase(60);
    await registry.write.publishNav([USTX, 100n * USD, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    // A liquidity provider opens the pool at the NAV: 50 USTX and $5,000.
    await dollar.write.claim();
    await dollar.write.approve([fund.address, maxUint256]);
    await fund.write.invest([5_000n * USD, 0n]);
    await dollar.write.approve([pool.address, maxUint256]);
    await fund.write.approve([pool.address, maxUint256]);
    await pool.write.addLiquidity([50n * USD, 5_000n * USD, 0n, 0n, maxUint256]);

    // The trader uses the app's own calldata, sent unchanged: approvals, a sale and a purchase.
    await dollar.write.claim({ account: trader.account });
    await dollar.write.approve([fund.address, maxUint256], { account: trader.account });
    await fund.write.invest([1_000n * USD, 0n], { account: trader.account });
    const send = async (to: Address, data: string) => {
      const hash = await trader.sendTransaction({ to, data: data as `0x${string}` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    await send(dollar.address, poolCalls.approveDollars(maxUint256).data);
    await send(fund.address, poolCalls.approveShares(maxUint256).data);
    expect(await dollar.read.allowance([trader.account.address, pool.address])).to.equal(maxUint256);
    expect(await fund.read.allowance([trader.account.address, pool.address])).to.equal(maxUint256);

    const deadline = Number(await time.latest()) + 600;
    // A sale pushes the pool below the NAV; after it a buy routes to the pool and a sale to the fund.
    const sale = poolAmountOut(3n * USD, 50n * USD, 5_000n * USD);
    expect(poolFill(await send(pool.address, poolCalls.sell(3n * USD, sale, deadline).data)))
      .to.deep.equal({ side: "sell", trader: trader.account.address.toLowerCase(), sharesMicros: 3n * USD, dollarsMicros: sale });
    const [shares, dollars] = await pool.read.getReserves();
    for (const size of [1n, 3_700_000n, 250n * USD, 4_000n * USD]) {
      expect(poolAmountOut(size, dollars, shares), `buy ${size}`).to.equal(await pool.read.quoteBuy([size]));
      expect(poolAmountOut(size, shares, dollars), `sell ${size}`).to.equal(await pool.read.quoteSell([size]));
    }
    const [nav] = await fund.read.currentNav();
    const route = routeOrder("buy", 100n * USD, nav, { sharesMicros: shares, dollarsMicros: dollars });
    expect(route.best).to.equal("pool");
    expect(routeOrder("sell", USD, nav, { sharesMicros: shares, dollarsMicros: dollars }).best).to.equal("fund");
    const buy = await send(pool.address, poolCalls.buy(100n * USD, route.pool!, deadline).data);
    expect(poolFill(buy)).to.deep.equal({ side: "buy", trader: trader.account.address.toLowerCase(), dollarsMicros: 100n * USD, sharesMicros: route.pool });
    expect(await fund.read.balanceOf([trader.account.address])).to.equal(10n * USD - 3n * USD + route.pool!);
    // A slippage limit above the quote is refused with the error the app explains.
    await expect(trader.sendTransaction({ to: pool.address, data: poolCalls.buy(100n * USD, 10n ** 12n, deadline).data as `0x${string}` })).to.be.rejectedWith("SlippageExceeded");
    expect(FUND_ERRORS["0x8199f5f3"]).to.match(/price changed/);

    // The arbitrage contract runs at its pinned address too. Its constructor approved the fund and
    // the pool from where it was deployed, so the pinned address approves them again.
    const arbitrageCode = await hre.viem.deployContract("GanymedeNavArbitrage", [pool.address]);
    const pinned = FUND_DEPLOYMENT.arbitrage as Address;
    await hre.network.provider.request({ method: "hardhat_setCode", params: [pinned, await publicClient.getCode({ address: arbitrageCode.address })] });
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [pinned] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [pinned, "0xde0b6b3a7640000"] });
    await dollar.write.approve([fund.address, maxUint256], { account: pinned });
    await dollar.write.approve([pool.address, maxUint256], { account: pinned });
    await fund.write.approve([pool.address, maxUint256], { account: pinned });
    await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [pinned] });
    const arbitrage = await hre.viem.getContractAt("GanymedeNavArbitrage", pinned);
    // A sale takes the pool below the NAV; a keeper buys there and redeems at the fund.
    await send(pool.address, poolCalls.sell(5n * USD, 0n, deadline).data);
    const [buyInPool, dollarsIn] = await arbitrage.read.quote();
    expect(buyInPool).to.equal(true);
    await dollar.write.approve([pinned, maxUint256], { account: trader.account });
    await arbitrage.write.buyAndRedeem([dollarsIn, 0n], { account: trader.account });

    // Market activity reads it all back from the chain's logs, the arbitrage as one row.
    const rows = await scanActivity(localRpc, firstBlock, Number(await publicClient.getBlockNumber()));
    expect(rows.map(row => row.kind)).to.deep.equal(["arbitrage", "sell", "buy", "sell", "addLiquidity"]);
    const [arbitraged] = await arbitrage.getEvents.Arbitraged();
    const [boughtByArbitrage] = (await pool.getEvents.Bought({}, { fromBlock: arbitraged.blockNumber, toBlock: arbitraged.blockNumber }));
    expect(rows[0]).to.deep.include({
      account: trader.account.address.toLowerCase(), hash: arbitraged.transactionHash, dollarsMicros: dollarsIn, dollarsOutMicros: arbitraged.args.dollarsOut,
      navMicros: nav, boughtInPool: true, sharesMicros: boughtByArbitrage.args.sharesOut,
    });
    expect(rows.some(row => row.account === pinned)).to.equal(false);
    expect(rows[2]).to.deep.include({ kind: "buy", account: trader.account.address.toLowerCase(), dollarsMicros: 100n * USD, sharesMicros: route.pool });
    expect(rows[4]).to.deep.include({ kind: "addLiquidity", account: admin.account.address.toLowerCase(), dollarsMicros: 5_000n * USD, sharesMicros: 50n * USD });
    expect(new Date(rows[0].at).getTime() / 1000).to.equal(Number((await publicClient.getBlock({ blockNumber: arbitraged.blockNumber })).timestamp));
  });

  it("reads, encodes and decodes the lending market as its contract does", async () => {
    const USD = 1_000_000n;
    const USTX = productKey("us-tech-x");
    const lendingAbi = (await hre.artifacts.readArtifact("GanymedeLendingMarket")).abi as readonly AbiItem[];
    const selectors = new Set(lendingAbi.filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(LENDING_SELECTORS)) expect(selectors.has(selector), name).to.equal(true);
    const events = lendingAbi.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const topic = (name: string) => toEventSelector(signature(events.find(item => item.name === name)!));
    expect(LENDING_EVENTS).to.deep.equal({
      supplied: topic("Supplied"), withdrawn: topic("Withdrawn"), collateralSupplied: topic("CollateralSupplied"),
      collateralWithdrawn: topic("CollateralWithdrawn"), borrowed: topic("Borrowed"), repaid: topic("Repaid"),
    });
    const errors = new Set(lendingAbi.filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(LENDING_ERRORS)) expect(errors.has(selector), selector).to.equal(true);

    const [admin, relayer, borrower, lender] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const firstBlock = Number(await publicClient.getBlockNumber()) + 1;
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([fund.address]);
    const local = await hre.viem.deployContract("GanymedeLendingMarket", [dollar.address, fund.address, admin.account.address]);
    expect([await local.read.BORROW_COLLATERAL_FACTOR(), await local.read.LIQUIDATION_THRESHOLD(), await local.read.LIQUIDATION_BONUS(), await local.read.MIN_BORROW()])
      .to.deep.equal([LENDING_TERMS.borrowFactorWad, LENDING_TERMS.liquidationThresholdWad, LENDING_TERMS.liquidationBonusWad, LENDING_TERMS.minBorrowMicros]);
    // The app's calldata names the deployed market: run this market's code, and the state its
    // constructor wrote, at that address.
    const pinned = FUND_DEPLOYMENT.lending as Address;
    await hre.network.provider.request({ method: "hardhat_setCode", params: [pinned, await publicClient.getCode({ address: local.address })] });
    for (let slot = 0; slot < 16; slot += 1) {
      const key = `0x${slot.toString(16).padStart(64, "0")}` as `0x${string}`;
      await hre.network.provider.request({ method: "hardhat_setStorageAt", params: [pinned, key, await publicClient.getStorageAt({ address: local.address, slot: key })] });
    }
    const market = await hre.viem.getContractAt("GanymedeLendingMarket", pinned);
    await market.write.unpause();
    // Time passes for interest; a fresh $100 NAV is recorded each time, as the app's cycle does.
    const later = async (seconds: number) => {
      await time.increase(seconds);
      await registry.write.publishNav([USTX, 100n * USD, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    };
    await later(60);

    const send = async (wallet: typeof admin, to: Address, data: string) => {
      const hash = await wallet.sendTransaction({ to, data: data as `0x${string}` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    // A lender supplies $5,000 through the app's calls.
    await dollar.write.claim({ account: lender.account });
    await send(lender, dollar.address, lendingCalls.approveDollars(5_000n * USD).data);
    expect(lendingFill(await send(lender, pinned, lendingCalls.supply(5_000n * USD).data), "lend")?.micros).to.equal(5_000n * USD);
    // A borrower buys 20 USTX, posts them and borrows $950.
    await dollar.write.claim({ account: borrower.account });
    await dollar.write.approve([fund.address, maxUint256], { account: borrower.account });
    await fund.write.invest([2_000n * USD, 0n], { account: borrower.account });
    await send(borrower, fund.address, lendingCalls.approveShares(20n * USD).data);
    expect(lendingFill(await send(borrower, pinned, lendingCalls.supplyCollateral(20n * USD).data), "deposit")).to.deep.equal({ action: "deposit", account: borrower.account.address.toLowerCase(), micros: 20n * USD });
    const before = lendingPosition(20n * USD, 0n, 100n * USD, await market.read.cash());
    const [value, borrowLimit, liquidationLimit] = await market.read.collateralValueOf([borrower.account.address]);
    expect([before.valueMicros, before.borrowLimitMicros, before.liquidationLimitMicros]).to.deep.equal([value, borrowLimit, liquidationLimit]);
    expect(lendingFill(await send(borrower, pinned, lendingCalls.borrow(500n * USD).data), "borrow")?.micros).to.equal(500n * USD);
    // An hour of interest later, borrowing the app's maximum still fits under the limit.
    await later(3_600);
    const most = lendingPosition(20n * USD, await market.read.borrowBalanceOf([borrower.account.address]), 100n * USD, await market.read.cash());
    expect(lendingFill(await send(borrower, pinned, lendingCalls.borrow(most.borrowableMicros).data), "borrow")?.micros).to.equal(most.borrowableMicros);
    expect((await market.read.borrowBalanceOf([borrower.account.address])) <= borrowLimit).to.equal(true);
    // Repay half, then an hour later withdraw the app's maximum; the rest is still needed.
    await send(borrower, dollar.address, lendingCalls.approveDollars(500n * USD).data);
    expect(lendingFill(await send(borrower, pinned, lendingCalls.repay(500n * USD).data), "repay")?.micros).to.equal(500n * USD);
    await later(3_600);
    const spare = lendingPosition(20n * USD, await market.read.borrowBalanceOf([borrower.account.address]), 100n * USD, await market.read.cash());
    expect(lendingFill(await send(borrower, pinned, lendingCalls.withdrawCollateral(spare.withdrawableMicros).data), "withdrawCollateral")?.micros).to.equal(spare.withdrawableMicros);
    await expect(borrower.sendTransaction({ to: pinned, data: lendingCalls.withdrawCollateral(LENDING_ALL).data as `0x${string}` })).to.be.rejectedWith("InsufficientCollateral");
    // Repaying everything, as the app does with LENDING_ALL and a little extra approved.
    await later(3_600);
    const owed = await market.read.borrowBalanceOf([borrower.account.address]);
    await send(borrower, dollar.address, lendingCalls.approveDollars(owed + owed / 1_000n + 1n).data);
    const repaid = lendingFill(await send(borrower, pinned, lendingCalls.repay(LENDING_ALL).data), "repay");
    expect(repaid!.micros >= owed).to.equal(true);
    expect(await market.read.borrowBalanceOf([borrower.account.address])).to.equal(0n);
    expect(lendingFill(await send(borrower, pinned, lendingCalls.withdrawCollateral(LENDING_ALL).data), "withdrawCollateral")?.micros).to.equal(20n * USD - spare.withdrawableMicros);
    // The lender takes everything back, interest included.
    const lent = lendingFill(await send(lender, pinned, lendingCalls.withdraw(LENDING_ALL).data), "withdraw");
    expect(lent!.micros > 5_000n * USD).to.equal(true);

    // Market activity lists each step, newest first, with the amounts the market reported.
    const rows = await scanActivity(localRpc, firstBlock, Number(await publicClient.getBlockNumber()));
    expect(rows.map(row => row.kind)).to.deep.equal(["withdraw", "withdrawCollateral", "repay", "withdrawCollateral", "repay", "borrow", "borrow", "deposit", "lend"]);
    expect(rows[0]).to.deep.include({ account: lender.account.address.toLowerCase(), dollarsMicros: lent!.micros });
    expect(rows[2]).to.deep.include({ account: borrower.account.address.toLowerCase(), dollarsMicros: repaid!.micros });
    expect(rows[7]).to.deep.include({ account: borrower.account.address.toLowerCase(), sharesMicros: 20n * USD });
  });

  it("adds and removes pool liquidity with the app's calls, exactly as the pool computes it", async () => {
    const USD = 1_000_000n;
    const USTX = productKey("us-tech-x");
    const pool = (await hre.artifacts.readArtifact("GanymedeUstxPool")).abi as readonly AbiItem[];
    const fund = (await hre.artifacts.readArtifact("GanymedeBasketFund")).abi as readonly AbiItem[];
    const selectors = new Set(pool.filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(LIQUIDITY_SELECTORS)) expect(selectors.has(selector), name).to.equal(true);
    const events = pool.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const topic = (name: string) => toEventSelector(signature(events.find(item => item.name === name)!));
    expect(LIQUIDITY_EVENTS).to.deep.equal({ added: topic("LiquidityAdded"), removed: topic("LiquidityRemoved") });
    const errors = new Set([...pool, ...fund].filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(LIQUIDITY_ERRORS)) expect(errors.has(selector), selector).to.equal(true);

    const [admin, relayer, provider, saver, trader] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const firstBlock = Number(await publicClient.getBlockNumber()) + 1;
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const ustx = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([ustx.address]);
    // The app's calldata names the deployed pool, so this pool's code runs at that address. An earlier
    // test left a pool there: empty its reserves, its supply and the balances it gave out.
    const local = await hre.viem.deployContract("GanymedeUstxPool", [ustx.address]);
    await hre.network.provider.request({ method: "hardhat_setCode", params: [FUND_DEPLOYMENT.pool, await publicClient.getCode({ address: local.address })] });
    const slot = (index: bigint) => `0x${index.toString(16).padStart(64, "0")}`;
    const balanceSlot = (holder: Address) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 3n]));
    for (const key of [slot(0n), slot(1n), slot(2n), balanceSlot(admin.account.address), balanceSlot(zeroAddress)]) {
      await hre.network.provider.request({ method: "hardhat_setStorageAt", params: [FUND_DEPLOYMENT.pool, key, slot(0n)] });
    }
    const market = await hre.viem.getContractAt("GanymedeUstxPool", FUND_DEPLOYMENT.pool as Address);
    expect([...await market.read.getReserves(), await market.read.totalSupply(), await market.read.balanceOf([admin.account.address])]).to.deep.equal([0n, 0n, 0n, 0n]);
    await time.increase(60);
    await registry.write.publishNav([USTX, 100n * USD, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    const send = async (wallet: typeof admin, to: Address, data: string) => {
      const hash = await wallet.sendTransaction({ to, data: data as `0x${string}` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    const state = async () => {
      const [sharesMicros, dollarsMicros] = await market.read.getReserves();
      return { sharesMicros, dollarsMicros, supply: await market.read.totalSupply() };
    };
    const deadline = async () => Number(await time.latest()) + 600;
    for (const wallet of [admin, provider, saver, trader]) {
      await dollar.write.claim({ account: wallet.account });
      await dollar.write.approve([ustx.address, maxUint256], { account: wallet.account });
    }

    // The first deposit opens the pool: both amounts in full, their geometric mean less 1,000 locked.
    await ustx.write.invest([5_000n * USD, 0n]);
    await send(admin, ustx.address, poolCalls.approveShares(50n * USD).data);
    await send(admin, dollar.address, poolCalls.approveDollars(5_000n * USD).data);
    const opening = quoteAddLiquidity(50n * USD, 5_000n * USD, await state());
    expect(opening).to.deep.equal({ sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD, liquidity: 500n * USD - POOL_MINIMUM_LIQUIDITY });
    expect(liquidityFill(await send(admin, market.address, liquidityCalls.add(50n * USD, 5_000n * USD, 0n, 0n, await deadline()).data)))
      .to.deep.equal({ side: "add", provider: admin.account.address.toLowerCase(), sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD, lpMicros: opening!.liquidity });

    // Trades move the pool off the NAV and pay fees in; only the fees raise √k per LP token.
    await ustx.write.invest([1_000n * USD, 0n], { account: trader.account });
    await send(trader, ustx.address, poolCalls.approveShares(maxUint256).data);
    await send(trader, dollar.address, poolCalls.approveDollars(maxUint256).data);
    const beforeTrades = await state();
    await send(trader, market.address, poolCalls.sell(4n * USD, 0n, await deadline()).data);
    await send(trader, market.address, poolCalls.buy(150n * USD, 0n, await deadline()).data);
    const afterTrades = await state();
    expect(invariantPerLp(afterTrades) > invariantPerLp(beforeTrades)).to.equal(true);

    // A provider types 3 USTX; the app pairs the demo dollars at the pool's ratio and the pool takes exactly the quote.
    await ustx.write.invest([1_000n * USD, 0n], { account: provider.account });
    const before = await state();
    const dollars = pairedDollars(3n * USD, before)!;
    const quote = quoteAddLiquidity(3n * USD, dollars, before)!;
    await send(provider, ustx.address, poolCalls.approveShares(quote.sharesMicros).data);
    await send(provider, dollar.address, poolCalls.approveDollars(quote.dollarsMicros).data);
    const added = liquidityFill(await send(provider, market.address, liquidityCalls.add(3n * USD, dollars, withSlippage(quote.sharesMicros), withSlippage(quote.dollarsMicros), await deadline()).data));
    expect(added).to.deep.equal({ side: "add", provider: provider.account.address.toLowerCase(), sharesMicros: quote.sharesMicros, dollarsMicros: quote.dollarsMicros, lpMicros: quote.liquidity });
    expect(await market.read.balanceOf([provider.account.address])).to.equal(quote.liquidity);
    // A deposit leaves √k per LP token where it was, give or take the pool's rounding in its favour.
    const deposited = await state();
    expect(invariantPerLp(deposited) >= invariantPerLp(before)).to.equal(true);
    expect(invariantPerLp(deposited) - invariantPerLp(before) < invariantPerLp(before) / 1_000_000n).to.equal(true);
    // Typed as dollars instead, the USTX follows the ratio the same way.
    const byDollars = quoteAddLiquidity(pairedShares(200n * USD, deposited)!, 200n * USD, deposited)!;
    expect(byDollars.dollarsMicros <= 200n * USD && 200n * USD - byDollars.dollarsMicros < 200n).to.equal(true);

    // Demo dollars alone: part invests at the fund at the NAV, the USTX goes in with the rest at the ratio.
    const [nav] = await ustx.read.currentNav();
    const split = splitDollarsOnly(1_000n * USD, nav, deposited)!;
    const sharesBefore = await ustx.read.balanceOf([saver.account.address]);
    await send(saver, ustx.address, fundCalls.invest(split.investMicros, withSlippage(split.sharesMicros)).data);
    const bought = (await ustx.read.balanceOf([saver.account.address])) - sharesBefore;
    expect(bought).to.equal(split.sharesMicros);
    const saverQuote = quoteAddLiquidity(bought, split.dollarsMicros, deposited)!;
    await send(saver, ustx.address, poolCalls.approveShares(bought).data);
    await send(saver, dollar.address, poolCalls.approveDollars(split.dollarsMicros).data);
    const saverFill = liquidityFill(await send(saver, market.address, liquidityCalls.add(bought, split.dollarsMicros, withSlippage(saverQuote.sharesMicros), withSlippage(saverQuote.dollarsMicros), await deadline()).data))!;
    expect([saverFill.sharesMicros, saverFill.dollarsMicros, saverFill.lpMicros]).to.deep.equal([saverQuote.sharesMicros, saverQuote.dollarsMicros, saverQuote.liquidity]);
    // At most dust stays behind: the split put the USTX and the dollars at the pool's ratio.
    expect(split.dollarsMicros - saverFill.dollarsMicros < 100n && bought - saverFill.sharesMicros < 2n).to.equal(true);

    // Withdrawing half pays exactly the quote; a minimum above it is refused with the error the app explains.
    const half = quote.liquidity / 2n;
    const out = quoteRemoveLiquidity(half, await state())!;
    await expect(provider.sendTransaction({ to: market.address, data: liquidityCalls.remove(half, out.sharesMicros + 1n, 0n, await deadline()).data as `0x${string}` })).to.be.rejectedWith("SlippageExceeded");
    expect(LIQUIDITY_ERRORS["0x8199f5f3"]).to.match(/price moved/);
    expect(liquidityFill(await send(provider, market.address, liquidityCalls.remove(half, withSlippage(out.sharesMicros), withSlippage(out.dollarsMicros), await deadline()).data)))
      .to.deep.equal({ side: "remove", provider: provider.account.address.toLowerCase(), sharesMicros: out.sharesMicros, dollarsMicros: out.dollarsMicros, lpMicros: half });
    // The rest comes out, and its USTX is redeemed at the fund at the NAV.
    const rest = await market.read.balanceOf([provider.account.address]);
    const last = quoteRemoveLiquidity(rest, await state())!;
    const removed = liquidityFill(await send(provider, market.address, liquidityCalls.remove(rest, withSlippage(last.sharesMicros), withSlippage(last.dollarsMicros), await deadline()).data))!;
    expect(removed.sharesMicros).to.equal(last.sharesMicros);
    const dollarsBefore = await dollar.read.balanceOf([provider.account.address]);
    await send(provider, ustx.address, fundCalls.redeem(removed.sharesMicros, withSlippage(dollarsFor(removed.sharesMicros, nav))).data);
    expect((await dollar.read.balanceOf([provider.account.address])) - dollarsBefore).to.equal(dollarsFor(removed.sharesMicros, nav));
    expect(await market.read.balanceOf([provider.account.address])).to.equal(0n);

    // Market activity lists the liquidity, and the 24-hour figures count the two trades and their fees.
    const rows = await scanActivity(localRpc, firstBlock, Number(await publicClient.getBlockNumber()));
    expect(rows.filter(row => row.kind === "addLiquidity").map(row => row.sharesMicros)).to.deep.equal([saverFill.sharesMicros, quote.sharesMicros, 50n * USD]);
    expect(rows.filter(row => row.kind === "removeLiquidity").map(row => row.dollarsMicros)).to.deep.equal([removed.dollarsMicros, out.dollarsMicros]);
    const counted = activityCounts(rows, 0);
    expect(counted.poolTrades).to.equal(2);
    const sold = rows.find(row => row.kind === "sell")!;
    expect(counted.poolVolumeMicros).to.equal(150n * USD + sold.dollarsMicros!);
    expect(counted.poolFeesMicros).to.equal(150n * USD * 30n / 10_000n + sold.dollarsMicros! * 30n / 9_970n);
  });

  it("points at the recorded deployment", () => {
    const record = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "xlayer-testnet.json"), "utf8"));
    expect(FUND_DEPLOYMENT.fund).to.equal(record.contracts.GanymedeBasketFund.address);
    expect(FUND_DEPLOYMENT.dollar).to.equal(record.contracts.GanymedeDemoDollar.address);
    expect(FUND_DEPLOYMENT.feed).to.equal(record.contracts.GanymedeNavFeed.address);
    expect(FUND_DEPLOYMENT.pool).to.equal(record.contracts.GanymedeUstxPool.address);
    expect(FUND_DEPLOYMENT.arbitrage).to.equal(record.contracts.GanymedeNavArbitrage.address);
    expect(FUND_DEPLOYMENT.lending).to.equal(record.contracts.GanymedeLendingMarket.address);
    expect(FUND_DEPLOYMENT.chainId).to.equal(record.chainId);
  });
});
