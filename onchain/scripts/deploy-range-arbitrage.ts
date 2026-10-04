/**
 * Replaces GanymedeRangeArbitrage next to the recorded GanymedeRangeLiquidityHook, which stays as
 * it is: the arbitrage holds nothing and has no owner, so a new one only needs recording and the
 * keeper's RANGE_ARBITRAGE_ADDRESS. The 4 October audit found that the first one reverted where no
 * position lay between the price and the NAV, which could leave the pool stuck away from the NAV;
 * this one moves the price across that stretch for nothing.
 *
 * On the in-process `hardhat` network it forks X Layer Testnet, deploys there and checks the call
 * the keeper makes; nothing is broadcast or recorded.
 *
 * Run: npm run fork:range-arbitrage, then npm run deploy:range-arbitrage
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import { formatUnits, type Address, type Hex } from "viem";
import { RAILS, deploymentPath, loadDeployment } from "./_deployment";

async function main() {
  const fork = hre.network.name === "hardhat";
  const rail = RAILS.xlayerTestnet;
  if (!fork && hre.network.name !== "xlayerTestnet") throw new Error("Run on xlayerTestnet, or on hardhat for the fork rehearsal.");
  const deployment = loadDeployment(rail);
  const { GanymedeRangeLiquidityHook: hookRecord, GanymedeRangeArbitrage: previous, GanymedeBasketFund: fundRecord } = deployment.contracts;
  if (!hookRecord?.seedTransaction || !fundRecord) throw new Error("No seeded range hook is recorded.");
  if (fork) {
    await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: process.env.XLAYER_RPC_URL || rail.rpcUrl } }] });
    await hre.network.provider.request({ method: "evm_mine", params: [] });
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [deployment.admin] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [deployment.admin, "0xde0b6b3a7640000"] });
  }
  const publicClient = await hre.viem.getPublicClient();
  const admin = fork ? await hre.viem.getWalletClient(deployment.admin as Address) : (await hre.viem.getWalletClients())[0];
  if (admin.account.address.toLowerCase() !== deployment.admin.toLowerCase()) throw new Error(`ADMIN_PRIVATE_KEY is ${admin.account.address}, but the recorded administrator is ${deployment.admin}.`);
  const artifact = await hre.artifacts.readArtifact("GanymedeRangeArbitrage");
  const hash = await admin.deployContract({
    account: admin.account, chain: admin.chain, abi: artifact.abi, bytecode: artifact.bytecode as Hex,
    args: [hookRecord.address as Address, fundRecord.address as Address], gas: 2_500_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment reverted: ${hash}`);
  const address = receipt.contractAddress;
  console.log(`GanymedeRangeArbitrage ${address}  (${hash}, gas ${receipt.gasUsed}); previous ${previous?.address ?? "none"}`);
  const arbitrage = await hre.viem.getContractAt("GanymedeRangeArbitrage", address);
  // What the keeper runs every five minutes: a call first.
  try {
    const { result } = await arbitrage.simulate.arbitrage([0n], { account: admin.account.address });
    console.log(`keeper's call now: profit ${formatUnits(result, 6)} dUSD`);
  } catch (error) {
    console.log(`keeper's call now: ${String((error as { shortMessage?: string }).shortMessage ?? error).split("\n")[0]}`);
  }
  if (fork) {
    console.log("fork rehearsal passed; nothing was broadcast.");
    return;
  }
  deployment.contracts.GanymedeRangeArbitrage = { address: address.toLowerCase(), deployedAt: new Date().toISOString(), deploymentTransaction: hash, constructorArgs: [hookRecord.address, fundRecord.address] };
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`wrote ${deploymentPath(rail)}; pin arbitrage ${address.toLowerCase()} in lib/xstocks/range-liquidity.ts and RANGE_ARBITRAGE_ADDRESS in relayer/wrangler.keeper.jsonc`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
