/**
 * Activates the USTX lending market that `npm run deploy:lending` recorded: the
 * administrator calls unpause(), after the same call has run as a simulation
 * against the latest block. Activating needs the user's approval (AGENTS.md).
 *
 * Supplying the first demo dollars to lend is left to lenders; this script only
 * unpauses. Demo dollars and USTX have no value.
 *
 * Run: npm run activate:lending
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import type { Address } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The lending market runs on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  const record = deployment.contracts.GanymedeLendingMarket;
  if (!record) throw new Error("No lending market is recorded. Run `npm run deploy:lending` first.");
  const [admin] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const adminAddress = admin.account.address;
  if (adminAddress.toLowerCase() !== deployment.admin.toLowerCase()) {
    throw new Error(`ADMIN_PRIVATE_KEY is ${adminAddress}, but the recorded administrator is ${deployment.admin}.`);
  }
  const chainId = await publicClient.getChainId();
  if (chainId !== rail.chainId) throw new Error(`RPC reports chain ${chainId}, expected ${rail.name} (${rail.chainId}).`);

  const market = await hre.viem.getContractAt("GanymedeLendingMarket", record.address as Address);
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`market       ${market.address}\n`);
  if ((await market.read.administrator()).toLowerCase() !== adminAddress.toLowerCase()) throw new Error("The admin key does not administer this market.");
  if (!(await market.read.paused())) {
    console.log("The market is already active; nothing to do.");
    return;
  }

  // The same call as a simulation first, so a revert shows before anything is sent.
  await market.simulate.unpause({ account: adminAddress });
  const nonce = await publicClient.getTransactionCount({ address: adminAddress, blockTag: "pending" });
  const hash = await market.write.unpause({ account: admin.account, nonce, gas: 80_000n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`unpause reverted: ${hash}`);
  console.log(`  unpaused   ${hash}`);

  // The public RPC is load-balanced, so read the result back at the receipt's block.
  let paused = true;
  for (let attempt = 0; attempt < 15 && paused; attempt += 1) {
    paused = await market.read.paused({ blockNumber: receipt.blockNumber }).catch(() => true);
    if (paused) await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  if (paused) throw new Error("The market still reads as paused.");
  console.log("  ok  market.paused = false");

  record.activatedAt = new Date().toISOString();
  record.unpauseTransaction = hash;
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
