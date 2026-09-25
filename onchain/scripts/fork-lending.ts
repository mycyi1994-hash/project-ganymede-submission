/**
 * Runs the lending market against the live X Layer Testnet contracts without
 * touching the chain. It forks X Layer Testnet into Hardhat's in-process
 * network, deploys GanymedeLendingMarket there next to the recorded dUSD, USTX
 * fund and NAV registry, and walks one full cycle with local test accounts:
 * supply, collateral bought at the live NAV, a loan, a 30% lower NAV recorded by
 * the (impersonated) publisher, liquidation, redemption of the seized USTX at
 * the fund, repayment and withdrawal. No key is used and nothing is broadcast.
 *
 * Run: npm run fork:lending
 */
import hre from "hardhat";
import { formatUnits, maxUint256, parseEventLogs, type Address } from "viem";
import { RAILS, loadDeployment } from "./_deployment";

const usd = (micros: bigint) => `$${Number(formatUnits(micros, 6)).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const ustx = (micros: bigint) => `${formatUnits(micros, 6)} USTX`;
const percent = (wad: bigint) => `${Number(formatUnits(wad, 16)).toFixed(2)}%`;

async function main() {
  if (hre.network.name !== "hardhat") throw new Error("This runs on a local fork only: npm run fork:lending");
  const rail = RAILS.xlayerTestnet;
  const { contracts } = loadDeployment(rail);
  if (!contracts.GanymedeDemoDollar || !contracts.GanymedeBasketFund) throw new Error("No fund is recorded for X Layer Testnet.");
  const rpcUrl = process.env.XLAYER_RPC_URL || rail.rpcUrl;
  await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: rpcUrl } }] });
  const publicClient = await hre.viem.getPublicClient();
  console.log(`forked ${rail.name} at block ${await publicClient.getBlockNumber()} (in memory only)\n`);

  const [deployer, lender, borrower, liquidator] = await hre.viem.getWalletClients();
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", contracts.GanymedeDemoDollar.address as Address);
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", contracts.GanymedeBasketFund.address as Address);
  const registry = await hre.viem.getContractAt("GanymedeNavRegistry", contracts.GanymedeNavRegistry.address as Address);
  const market = await hre.viem.deployContract("GanymedeLendingMarket", [dollar.address, fund.address, deployer.account.address]);
  console.log(`market deployed on the fork at ${market.address}, paused: ${await market.read.paused()}`);
  await market.write.unpause();

  const [nav, effectiveAt] = await fund.read.currentNav();
  console.log(`live USTX NAV ${usd(nav)}, recorded ${new Date(Number(effectiveAt) * 1000).toISOString()}`);
  for (const wallet of [lender, borrower, liquidator]) {
    await dollar.write.claim({ account: wallet.account });
    await dollar.write.approve([market.address, maxUint256], { account: wallet.account });
    await dollar.write.approve([fund.address, maxUint256], { account: wallet.account });
    await fund.write.approve([market.address, maxUint256], { account: wallet.account });
  }

  await market.write.supply([5_000_000_000n], { account: lender.account });
  await fund.write.invest([2_000_000_000n, 0n], { account: borrower.account });
  const shares = await fund.read.balanceOf([borrower.account.address]);
  await market.write.supplyCollateral([shares], { account: borrower.account });
  const [value, borrowLimit, liquidationLimit] = await market.read.collateralValueOf([borrower.account.address]);
  const loan = (borrowLimit * 95n) / 100n;
  await market.write.borrow([loan], { account: borrower.account });
  console.log(`lender supplied $5,000; borrower bought ${ustx(shares)} for $2,000 and posted it (worth ${usd(value)})`);
  console.log(`borrowed ${usd(loan)} of a ${usd(borrowLimit)} limit; liquidation above ${usd(liquidationLimit)}`);
  console.log(
    `utilization ${percent(await market.read.utilization())}, borrow rate ${percent(await market.read.borrowRatePerYear())}/yr, supply rate ${percent(await market.read.supplyRatePerYear())}/yr`,
  );

  // The publisher, impersonated on the fork, records a NAV 30% lower.
  const publisher = await registry.read.publisher();
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [publisher] });
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [publisher, "0xde0b6b3a7640000"] });
  const productId = await fund.read.productId();
  const [, sharesOutstanding, holdingsHash] = await registry.read.latestNav([productId]);
  const lower = (nav * 70n) / 100n;
  const now = (await publicClient.getBlock()).timestamp;
  await registry.write.publishNav([productId, lower, sharesOutstanding, holdingsHash, now], { account: publisher });
  console.log(`\nNAV recorded 30% lower on the fork: ${usd(lower)}; liquidatable: ${await market.read.isLiquidatable([borrower.account.address])}`);

  const debt = await market.read.borrowBalanceOf([borrower.account.address]);
  const hash = await market.write.liquidate([borrower.account.address, maxUint256, 0n], { account: liquidator.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [liquidated] = parseEventLogs({ abi: market.abi, logs: receipt.logs, eventName: "Liquidated" });
  const { repaid, seized } = liquidated.args;
  const before = await dollar.read.balanceOf([liquidator.account.address]);
  await fund.write.redeem([seized, 0n], { account: liquidator.account });
  const proceeds = (await dollar.read.balanceOf([liquidator.account.address])) - before;
  console.log(`liquidator repaid ${usd(repaid)} of ${usd(debt)}, received ${ustx(seized)}, and redeemed it at the fund for ${usd(proceeds)}`);
  console.log(`bonus ${usd(proceeds - repaid)} (${((Number(proceeds - repaid) * 100) / Number(repaid)).toFixed(2)}%)`);

  await market.write.repay([maxUint256], { account: borrower.account });
  await market.write.withdrawCollateral([maxUint256], { account: borrower.account });
  await market.write.withdraw([maxUint256], { account: lender.account });
  console.log(
    `\nafter repayment and withdrawals: borrowed ${usd(await market.read.totalBorrowed())}, supplied ${usd(await market.read.totalSupplied())}, collateral ${ustx(await market.read.totalCollateral())}, reserves ${usd(await market.read.reserves())}`,
  );
  console.log("Nothing was broadcast; the fork is discarded when this process exits.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
