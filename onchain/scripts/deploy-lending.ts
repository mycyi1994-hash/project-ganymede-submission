/**
 * Deploys the USTX lending market on X Layer Testnet, next to the fund that
 * `npm run deploy:fund` recorded:
 *
 *   GanymedeLendingMarket   administrator = ADMIN   (constructor)
 *                           lends         = GanymedeDemoDollar (dUSD)
 *                           collateral    = GanymedeBasketFund (USTX), at the fund's current NAV
 *
 * The market is deployed paused, and this script leaves it paused: nothing can
 * be supplied or borrowed until the administrator calls unpause(). Deploying
 * and activating are separate decisions that need the user's approval
 * (AGENTS.md).
 *
 * The public RPC is load-balanced and a node can lag behind the last receipt, so
 * the deployment carries its own nonce and gas limit and waits for its receipt.
 *
 * Run: npm run deploy:lending
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import type { Abi, Address, Hex } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";

// eth_estimateGas on X Layer Testnet gave 1,757,871 for this deployment; the limit leaves headroom.
const DEPLOY_GAS = 2_300_000n;

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The lending market is deployed on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  const { GanymedeDemoDollar: dollarRecord, GanymedeBasketFund: fundRecord, GanymedeLendingMarket: existing } = deployment.contracts;
  if (!dollarRecord || !fundRecord) throw new Error("No fund is recorded. Run `npm run deploy:fund` first.");
  if (existing) {
    throw new Error(`A lending market is already recorded at ${existing.address}. Remove it from the record to redeploy.`);
  }
  const [admin] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const adminAddress = admin.account.address;
  if (adminAddress.toLowerCase() !== deployment.admin.toLowerCase()) {
    throw new Error(`ADMIN_PRIVATE_KEY is ${adminAddress}, but the recorded administrator is ${deployment.admin}.`);
  }
  const chainId = await publicClient.getChainId();
  if (chainId !== rail.chainId) throw new Error(`RPC reports chain ${chainId}, expected ${rail.name} (${rail.chainId}).`);
  if ((await publicClient.getBalance({ address: adminAddress })) === 0n) {
    throw new Error(`Admin ${adminAddress} has no ${rail.gasToken}. Fund it from the faucet first.`);
  }

  const dollarAddress = dollarRecord.address as Address;
  const fundAddress = fundRecord.address as Address;
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`dUSD         ${dollarAddress}`);
  console.log(`USTX fund    ${fundAddress}\n`);

  console.log("deploying GanymedeLendingMarket (paused)...");
  const args = [dollarAddress, fundAddress, adminAddress] as const;
  const artifact = await hre.artifacts.readArtifact("GanymedeLendingMarket");
  const nonce = await publicClient.getTransactionCount({ address: adminAddress, blockTag: "pending" });
  const hash = await admin.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: [...args], nonce, gas: DEPLOY_GAS });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment reverted: ${hash}`);
  const deployedAt = new Date().toISOString();
  const market = await hre.viem.getContractAt("GanymedeLendingMarket", receipt.contractAddress);
  console.log(`  ${market.address}  (transaction ${hash}, gas ${receipt.gasUsed})`);
  // The wiring reads below need the code; a lagging node may not serve it yet.
  for (let attempt = 0; attempt < 15 && ((await publicClient.getCode({ address: market.address })) ?? "0x") === "0x"; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  // Read the wiring back. The public RPC is load-balanced, so retry briefly.
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["market.dollar", () => market.read.dollar(), dollarAddress],
    ["market.fund", () => market.read.fund(), fundAddress],
    ["market.administrator", () => market.read.administrator(), adminAddress],
    ["market.paused", async () => String(await market.read.paused()), "true"],
  ];
  for (const [label, read, expected] of checks) {
    let actual = await read().catch(() => "");
    for (let attempt = 1; attempt < 15 && actual.toLowerCase() !== expected.toLowerCase(); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      actual = await read().catch(() => "");
    }
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`wiring failed: ${label} is ${actual}, expected ${expected}`);
    console.log(`  ok  ${label} = ${actual}`);
  }

  deployment.contracts.GanymedeLendingMarket = { address: market.address, deployedAt, deploymentTransaction: hash, constructorArgs: [...args] };
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
  console.log("The market is paused. Activating it (unpause) is a separate decision; this script never does it.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
