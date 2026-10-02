/**
 * Runs the Uniswap v4 RWA liquidity hook against the live X Layer Testnet contracts without
 * touching the chain. It forks X Layer Testnet into Hardhat's in-process network and deploys
 * Uniswap's PoolManager, GanymedeRwaLiquidityHook (USTX / dUSD, priced by the recorded
 * GanymedeNavFeed) and GanymedeV4Router with the routine `npm run deploy:v4` uses. Then, with local
 * test accounts: a liquidity provider deposits USTX bought at the live NAV with the same value in
 * dUSD; a trader buys and sells; a second provider deposits, which waits for the next record; the
 * (impersonated) publisher records a NAV 1% higher, which opens an arbitrage against the live
 * constant-product pool, while the next swap re-pegs the hooked pool and turns the waiting deposit
 * into shares; and both providers withdraw. No key is used and nothing is broadcast.
 *
 * Run: npm run fork:v4
 */
import hre from "hardhat";
import { createPublicClient, formatUnits, http, maxUint256, parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { RAILS, loadDeployment } from "./_deployment";
import {
  XLAYER_MAINNET_POOL_MANAGER,
  deployRwaLiquidity,
  isPoolManagerCode,
  poolManagerArtifact,
  readSlot0,
  sqrtPriceToUsd,
  tickToUsd,
} from "./_v4";

const MAINNET_RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";

const USD = 1_000_000n;
const SHARE = 1_000_000n;
const usd = (micros: bigint) => `$${Number(formatUnits(micros, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
const ustx = (micros: bigint) => `${formatUnits(micros, 6)} USTX`;
const price = (value: number) => `$${value.toFixed(4)}`;

async function main() {
  if (hre.network.name !== "hardhat") throw new Error("This runs on a local fork only: npm run fork:v4");
  // Uniswap has not deployed v4 on X Layer Testnet; the pool manager deployed here is v4-core
  // 1.0.2 as Uniswap built it. Check that it is the code Uniswap runs on X Layer mainnet.
  try {
    const mainnet = createPublicClient({ transport: http(MAINNET_RPC) });
    const code = (await mainnet.getCode({ address: XLAYER_MAINNET_POOL_MANAGER })) ?? "0x";
    console.log(
      isPoolManagerCode(code)
        ? `Uniswap's PoolManager on X Layer mainnet (${XLAYER_MAINNET_POOL_MANAGER}) runs the same code as the one deployed below, apart from its own address`
        : `WARNING: the code at ${XLAYER_MAINNET_POOL_MANAGER} on X Layer mainnet differs from v4-core 1.0.2's PoolManager`,
    );
  } catch (error) {
    console.log(`(could not read X Layer mainnet to compare the PoolManager: ${String(error).split("\n")[0]})`);
  }
  const rail = RAILS.xlayerTestnet;
  const { contracts } = loadDeployment(rail);
  const { GanymedeDemoDollar: dollarRecord, GanymedeBasketFund: fundRecord, GanymedeNavFeed: feedRecord } = contracts;
  if (!dollarRecord || !fundRecord || !feedRecord) throw new Error("No fund and NAV feed are recorded for X Layer Testnet.");
  const rpcUrl = process.env.XLAYER_RPC_URL || rail.rpcUrl;
  await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: rpcUrl } }] });
  const publicClient = await hre.viem.getPublicClient();
  console.log(`forked ${rail.name} at block ${await publicClient.getBlockNumber()} (in memory only)\n`);
  // Calls run on a local block: the node knows no hardfork history for X Layer's own blocks.
  await hre.network.provider.request({ method: "evm_mine", params: [] });

  const [deployer, provider, trader, second] = await hre.viem.getWalletClients();
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", dollarRecord.address as Address);
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", fundRecord.address as Address);
  const registry = await hre.viem.getContractAt("GanymedeNavRegistry", contracts.GanymedeNavRegistry.address as Address);
  const feed = await hre.viem.getContractAt("GanymedeNavFeed", feedRecord.address as Address);
  const productId = await fund.read.productId();
  const publisher = await registry.read.publisher();
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [publisher] });
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [publisher, "0xde0b6b3a7640000"] });
  async function record(nav: bigint) {
    const [, sharesOutstanding, holdingsHash] = await registry.read.latestNav([productId]);
    const now = (await publicClient.getBlock()).timestamp;
    await registry.write.publishNav([productId, nav, sharesOutstanding, holdingsHash, now], { account: publisher });
  }

  // The hook refuses a NAV over an hour old, as the fund does. The live record runs every five
  // minutes; if it has stalled, record the same NAV again at the fork's time.
  const [, answer, , updatedAt] = await feed.read.latestRoundData();
  const age = (await publicClient.getBlock()).timestamp - updatedAt;
  const liveNav = BigInt(answer) / 100n;
  console.log(`live USTX NAV ${usd(liveNav)} from ${feed.address}, recorded ${age} s before the fork's latest block`);
  if (age > 3_000n) {
    await record(liveNav);
    console.log("  over 50 minutes old: recorded the same NAV again at the fork's time");
  }

  console.log("\ndeploying on the fork...");
  const hookArtifact = await hre.artifacts.readArtifact("GanymedeRwaLiquidityHook");
  const routerArtifact = await hre.artifacts.readArtifact("GanymedeV4Router");
  const deployed = await deployRwaLiquidity({
    wallet: deployer,
    publicClient,
    hookArtifact: { abi: hookArtifact.abi, bytecode: hookArtifact.bytecode as Hex },
    routerArtifact: { abi: routerArtifact.abi, bytecode: routerArtifact.bytecode as Hex },
    asset: fund.address,
    dollar: dollar.address,
    feed: feed.address,
    name: "Ganymede USTX-dUSD v4 LP",
    symbol: "USTX-V4LP",
    log: line => console.log(line),
  });
  const hook = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", deployed.hook.address);
  const router = await hre.viem.getContractAt("GanymedeV4Router", deployed.router.address);
  const managerAddress = deployed.poolManager.address;
  const key = await hook.read.poolKey();
  const poolId = await hook.read.poolId();
  const assetIsCurrency0 = await hook.read.assetIsCurrency0();
  const pair = (shares: bigint, dollars: bigint): [bigint, bigint] => (assetIsCurrency0 ? [shares, dollars] : [dollars, shares]);
  const split = ([amount0, amount1]: readonly [bigint, bigint]) => (assetIsCurrency0 ? { shares: amount0, dollars: amount1 } : { shares: amount1, dollars: amount0 });
  const poolPrice = async () => sqrtPriceToUsd((await readSlot0(publicClient, managerAddress, poolId)).sqrtPriceX96, assetIsCurrency0);
  const valueAt = async (nav: bigint) => {
    const held = split(await hook.read.totalAmounts());
    return (held.shares * nav) / SHARE + held.dollars;
  };
  const gas: Array<[string, bigint]> = [
    ["deploy PoolManager", "gasUsed" in deployed.poolManager ? deployed.poolManager.gasUsed : 0n],
    ["deploy hook", deployed.hook.gasUsed],
    ["deploy router", deployed.router.gasUsed],
  ];
  async function send(label: string, hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    gas.push([label, receipt.gasUsed]);
    return parseEventLogs({ abi: [...hook.abi, ...router.abi, ...poolManagerArtifact().abi], logs: receipt.logs });
  }
  const deadline = async () => (await publicClient.getBlock()).timestamp + 900n;
  console.log(`pool ${poolId}: USTX is currency${assetIsCurrency0 ? 0 : 1}, opened at ${price(await poolPrice())}`);

  for (const wallet of [provider, trader, second]) {
    await dollar.write.claim({ account: wallet.account });
    for (const spender of [fund.address, hook.address, router.address]) await dollar.write.approve([spender, maxUint256], { account: wallet.account });
    for (const spender of [hook.address, router.address]) await fund.write.approve([spender, maxUint256], { account: wallet.account });
  }
  await fund.write.invest([5_000n * USD, 0n], { account: provider.account });
  const providerShares = await fund.read.balanceOf([provider.account.address]);
  let logs = await send("first deposit", await hook.write.deposit([...pair(providerShares, 5_000n * USD), await deadline()], { account: provider.account }));
  const firstShares = await hook.read.balanceOf([provider.account.address]);
  const [baseLower, baseUpper] = await hook.read.baseRange();
  console.log(`\nprovider bought ${ustx(providerShares)} for $5,000 at the fund and deposited it with $5,000: ${formatUnits(firstShares, 6)} LP shares`);
  const [low, high] = [tickToUsd(baseLower, assetIsCurrency0), tickToUsd(baseUpper, assetIsCurrency0)].sort((a, b) => a - b);
  console.log(`  base range ${price(low)} to ${price(high)} around the NAV; holdings worth ${usd(await valueAt(liveNav))} at the NAV`);

  const traderBefore = await fund.read.balanceOf([trader.account.address]);
  logs = await send("swap", await router.write.swapExactInput([key, !assetIsCurrency0, 1_000n * USD, 0n, await deadline()], { account: trader.account }));
  const bought = (await fund.read.balanceOf([trader.account.address])) - traderBefore;
  const fee = (logs.find(event => event.eventName === "Swap")!.args as { fee: number }).fee;
  console.log(`\ntrader bought ${ustx(bought)} for $1,000 (${usd((1_000n * USD * SHARE) / bought)} each, fee ${(fee / 10_000).toFixed(4)}%); pool price now ${price(await poolPrice())}`);
  await send("swap", await router.write.swapExactInput([key, assetIsCurrency0, bought / 2n, 0n, await deadline()], { account: trader.account }));
  console.log(`trader sold half of it back; pool price ${price(await poolPrice())}`);

  // A later deposit waits for the next NAV record and is priced there.
  await fund.write.invest([2_000n * USD, 0n], { account: second.account });
  const secondShares = await fund.read.balanceOf([second.account.address]);
  logs = await send("later deposit", await hook.write.deposit([...pair(secondShares, 2_000n * USD), await deadline()], { account: second.account }));
  const [waiting0, waiting1] = await hook.read.pendingOf([second.account.address]);
  const waiting = split([waiting0, waiting1]);
  console.log(`second provider deposited ${ustx(waiting.shares)} and ${usd(waiting.dollars)} at the pool's ratio; it waits for the next NAV record`);

  // A NAV 1% higher: the constant-product pool now sells USTX below the NAV.
  const newNav = (liveNav * 101n) / 100n;
  await record(newNav);
  console.log(`\npublisher (impersonated) records a NAV 1% higher: ${usd(newNav)}`);
  const v2Record = contracts.GanymedeUstxPool;
  const arbitrageRecord = contracts.GanymedeNavArbitrage;
  if (v2Record && arbitrageRecord) {
    const v2 = await hre.viem.getContractAt("GanymedeUstxPool", v2Record.address as Address);
    const arbitrage = await hre.viem.getContractAt("GanymedeNavArbitrage", arbitrageRecord.address as Address);
    console.log(`  live constant-product pool price ${usd(await v2.read.price())}, ${Number(await v2.read.premiumBps()) / 100}% from the new NAV`);
    const [reserveShares, reserveDollars] = await v2.read.getReserves();
    const before = (reserveShares * newNav) / SHARE + reserveDollars;
    const [buyInPool, dollarsIn] = await arbitrage.read.quote();
    if (buyInPool && dollarsIn > 0n) {
      await dollar.write.approve([arbitrage.address, maxUint256], { account: trader.account });
      const dollarsBefore = await dollar.read.balanceOf([trader.account.address]);
      await arbitrage.write.buyAndRedeem([dollarsIn, 0n], { account: trader.account });
      const profit = (await dollar.read.balanceOf([trader.account.address])) - dollarsBefore;
      const [afterShares, afterDollars] = await v2.read.getReserves();
      const loss = before - ((afterShares * newNav) / SHARE + afterDollars);
      console.log(`  an arbitrage bought its USTX below the NAV and redeemed it at the fund for ${usd(profit)}; its providers (${usd(before)} at the new NAV) lost ${usd(loss)}`);
    } else {
      console.log("  live constant-product pool: no profitable arbitrage at this size");
    }
  }
  // What the first provider's shares would withdraw, valued at the new NAV.
  const firstWorth = async () => {
    const paid = split(await hook.read.previewWithdraw([firstShares]));
    return (paid.shares * newNav) / SHARE + paid.dollars;
  };
  const firstBefore = await firstWorth();
  logs = await send("swap that re-pegs", await router.write.swapExactInput([key, !assetIsCurrency0, 10n * USD, 0n, await deadline()], { account: trader.account }));
  const repegged = logs.find(event => event.eventName === "Repegged");
  const converted = logs.find(event => event.eventName === "Converted")?.args as { value: bigint; shares: bigint } | undefined;
  if (!repegged || !converted) throw new Error("the swap after the record did not re-peg the pool and convert the deposit");
  console.log(`  hooked pool: the next swap moved it to the new NAV before trading; price after the $10 swap ${price(await poolPrice())}`);
  console.log(`  the first provider's shares at the new NAV: ${usd(firstBefore)} before, ${usd(await firstWorth())} after (with their part of the $10 swap's fee)`);
  console.log(`  the waiting deposit, worth ${usd(converted.value)} at the new NAV, became ${formatUnits(converted.shares, 6)} shares`);

  const shares = await hook.read.balanceOf([provider.account.address]);
  const [out0, out1] = await hook.read.previewWithdraw([shares]);
  await send("withdraw", await hook.write.withdraw([shares, out0, out1, await deadline()], { account: provider.account }));
  const paid = split([out0, out1]);
  const worth = (paid.shares * newNav) / SHARE + paid.dollars;
  const held = (providerShares * newNav) / SHARE + 5_000n * USD;
  console.log(`\nprovider withdrew ${ustx(paid.shares)} and ${usd(paid.dollars)}: ${usd(worth)} at the new NAV (holding the deposit instead: ${usd(held)})`);
  const secondOwned = await hook.read.claimableShares([second.account.address]);
  const [second0, second1] = await hook.read.previewWithdraw([secondOwned]);
  await send("claim and withdraw", await hook.write.withdraw([secondOwned, second0, second1, await deadline()], { account: second.account }));
  const secondPaid = split([second0, second1]);
  const secondWorth = (secondPaid.shares * newNav) / SHARE + secondPaid.dollars;
  console.log(`second provider claimed its shares and withdrew ${ustx(secondPaid.shares)} and ${usd(secondPaid.dollars)}: ${usd(secondWorth)} at the new NAV`);

  console.log("\ngas used");
  for (const [label, used] of gas) console.log(`  ${label.padEnd(20)} ${used.toLocaleString("en-US")}`);
  console.log("\nNothing was broadcast; the fork is discarded when this process exits.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
