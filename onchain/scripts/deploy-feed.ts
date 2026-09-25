/**
 * Deploys the USTX NAV feed on X Layer Testnet, next to the NAV registry that
 * `npm run deploy` recorded:
 *
 *   GanymedeNavFeed   reads    = GanymedeNavRegistry, product "us-tech-x"
 *                     answers  = AggregatorV3Interface, 8 decimals, "USTX / USD"
 *
 * The feed has no owner and no settings to change; it only reads the registry.
 *
 * Run: npm run deploy:feed
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";
import { productKey } from "../../relayer/src/ids";

const FEED_PRODUCT_ID = "us-tech-x";
const FEED_DESCRIPTION = "USTX / USD";

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The NAV feed is deployed on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  if (deployment.contracts.GanymedeNavFeed) {
    throw new Error(`A feed is already recorded at ${deployment.contracts.GanymedeNavFeed.address}. Remove it from the record to redeploy.`);
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

  const registryAddress = deployment.contracts.GanymedeNavRegistry.address as Address;
  const key = productKey(FEED_PRODUCT_ID);
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`deployer     ${adminAddress}`);
  console.log(`registry     ${registryAddress}`);
  console.log(`product      ${FEED_PRODUCT_ID} ${key}\n`);

  // Send the deployment ourselves and wait for its receipt, so the creation
  // transaction is recorded for source verification.
  console.log("deploying GanymedeNavFeed...");
  const args = [registryAddress, key, FEED_DESCRIPTION] as const;
  const artifact = await hre.artifacts.readArtifact("GanymedeNavFeed");
  const hash = await admin.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [...args] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment failed: ${hash}`);
  const deployedAt = new Date().toISOString();
  const feed = await hre.viem.getContractAt("GanymedeNavFeed", receipt.contractAddress);
  console.log(`  ${feed.address}  (tx ${hash})`);

  // Read the wiring back at the deployment block. The public RPC is load-balanced, so retry briefly.
  const at = { blockNumber: receipt.blockNumber };
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["feed.registry", () => feed.read.registry(at), registryAddress],
    ["feed.productId", () => feed.read.productId(at), key],
    ["feed.decimals", async () => String(await feed.read.decimals(at)), "8"],
    ["feed.description", () => feed.read.description(at), FEED_DESCRIPTION],
  ];
  const registry = await hre.viem.getContractAt("GanymedeNavRegistry", registryAddress);
  const [nav, , , effectiveAt] = await retry(() => registry.read.latestNav([key], at));
  checks.push(["feed.latestRoundData", async () => {
    const [roundId, answer, , updatedAt] = await feed.read.latestRoundData(at);
    return `${roundId}/${answer}/${updatedAt}`;
  }, `${effectiveAt}/${nav * 100n}/${effectiveAt}`]);
  for (const [label, read, expected] of checks) {
    const actual = await retry(read, value => value.toLowerCase() === expected.toLowerCase());
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`wiring failed: ${label} is ${actual}, expected ${expected}`);
    console.log(`  ok  ${label} = ${actual}`);
  }

  deployment.contracts.GanymedeNavFeed = {
    address: feed.address,
    deployedAt,
    deploymentTransaction: hash,
    productId: FEED_PRODUCT_ID,
    description: FEED_DESCRIPTION,
    constructorArgs: [...args],
  };
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
  console.log("next: npm run verify:export for the explorer, and the Sourcify check in README.md");
}

async function retry<T>(read: () => Promise<T>, done: (value: T) => boolean = () => true): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const value = await read();
      if (done(value) || attempt === 9) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw lastError;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
