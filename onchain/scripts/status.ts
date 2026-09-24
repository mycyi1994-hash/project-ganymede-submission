/**
 * Reads live contract state back off the settlement rail.
 *
 * Use this to confirm the deployment is wired correctly and to collect the
 * explorer links for a grant or diligence submission.
 *
 * Run: npm run status          (X Layer testnet)
 *      npm run status:giwa     (GIWA Sepolia)
 */
import hre from "hardhat";
import type { Address } from "viem";
import { loadDeployment, railFor } from "./_deployment";
import { productKey } from "../../relayer/src/ids";

async function main() {
  const rail = railFor(hre.network.name);
  const deployment = loadDeployment(rail);
  const publicClient = await hre.viem.getPublicClient();

  const share = await hre.viem.getContractAt(
    "GanymedeFundShare",
    deployment.contracts.GanymedeFundShare.address as Address,
  );
  const registry = await hre.viem.getContractAt(
    "GanymedeNavRegistry",
    deployment.contracts.GanymedeNavRegistry.address as Address,
  );

  const [name, symbol, totalSupply, issuer, administrator, sharePaused] = await Promise.all([
    share.read.name(),
    share.read.symbol(),
    share.read.totalSupply(),
    share.read.issuer(),
    share.read.administrator(),
    share.read.paused(),
  ]);

  console.log("GanymedeFundShare");
  console.log(`  address        ${deployment.contracts.GanymedeFundShare.address}`);
  console.log(`  fund           ${name} (${symbol})`);
  console.log(`  totalSupply    ${totalSupply} micros`);
  console.log(`  issuer         ${issuer}`);
  console.log(`  administrator  ${administrator}`);
  console.log(`  paused         ${sharePaused}`);
  console.log(`  explorer       ${deployment.explorer}/address/${deployment.contracts.GanymedeFundShare.address}`);

  const [publisher, registryAdmin, registryPaused] = await Promise.all([
    registry.read.publisher(),
    registry.read.administrator(),
    registry.read.paused(),
  ]);

  console.log("\nGanymedeNavRegistry");
  console.log(`  address        ${deployment.contracts.GanymedeNavRegistry.address}`);
  console.log(`  publisher      ${publisher}`);
  console.log(`  administrator  ${registryAdmin}`);
  console.log(`  paused         ${registryPaused}`);
  console.log(`  explorer       ${deployment.explorer}/address/${deployment.contracts.GanymedeNavRegistry.address}`);

  console.log("\nlatest NAV per product");
  for (const productId of ["us-tech-x", "core-20", "digital-income", "tech-leaders", "next-frontier"]) {
    const snapshot = await registry.read.latestNav([productKey(productId)]);
    const [navPerShareMicros, sharesOutstanding, holdingsHash, effectiveAt] = snapshot;
    if (effectiveAt === 0n) {
      console.log(`  ${productId.padEnd(15)} (nothing published yet)`);
      continue;
    }
    console.log(
      `  ${productId.padEnd(15)} nav=${navPerShareMicros} shares=${sharesOutstanding} ` +
        `at=${new Date(Number(effectiveAt) * 1000).toISOString()}`,
    );
    console.log(`  ${" ".repeat(15)} holdings=${holdingsHash}`);
  }

  const balance = await publicClient.getBalance({ address: deployment.relayer as Address });
  console.log(`\nrelayer ${deployment.relayer} balance ${balance} wei (${rail.gasToken})`);
  if (balance === 0n) console.log(`  WARNING: relayer cannot pay gas — top it up with ${rail.gasToken} from the faucet.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
