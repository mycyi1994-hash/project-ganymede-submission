/**
 * Deploys wallet investing for USTX on X Layer Testnet, next to the NAV registry
 * that `npm run deploy` recorded:
 *
 *   GanymedeDemoDollar   administrator = ADMIN   (constructor)
 *                        minter        = fund    (setMinter, this script)
 *
 *   GanymedeBasketFund   administrator = ADMIN   (constructor)
 *                        prices from   = GanymedeNavRegistry, product "us-tech-x"
 *
 * Demo dollars have no value. The fund issues USTX only when someone invests at
 * the NAV recorded in the registry, and pays redemptions in newly minted demo
 * dollars; no key can issue shares directly.
 *
 * Run: npm run deploy:fund
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import type { Address } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";
import { productKey } from "../../relayer/src/ids";

const FUND_PRODUCT_ID = "us-tech-x";
const FUND_NAME = "Ganymede US Tech Basket";
const FUND_SYMBOL = "USTX";

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("Wallet investing is deployed on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  if (deployment.contracts.GanymedeBasketFund) {
    throw new Error(`A fund is already recorded at ${deployment.contracts.GanymedeBasketFund.address}. Remove it from the record to redeploy.`);
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
  const key = productKey(FUND_PRODUCT_ID);
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`registry     ${registryAddress}`);
  console.log(`product      ${FUND_PRODUCT_ID} ${key}\n`);

  console.log("deploying GanymedeDemoDollar...");
  const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [adminAddress], { client: { wallet: admin } });
  const dollarDeployedAt = new Date().toISOString();
  console.log(`  ${dollar.address}`);

  console.log("deploying GanymedeBasketFund...");
  const fundArgs = [FUND_NAME, FUND_SYMBOL, dollar.address, registryAddress, key, adminAddress] as const;
  const fund = await hre.viem.deployContract("GanymedeBasketFund", [...fundArgs], { client: { wallet: admin } });
  const fundDeployedAt = new Date().toISOString();
  console.log(`  ${fund.address}`);

  console.log("\nletting the fund mint demo dollars for redemptions...");
  const setMinterTx = await dollar.write.setMinter([fund.address], { account: admin.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: setMinterTx });
  if (receipt.status !== "success") throw new Error(`setMinter reverted: ${setMinterTx}`);
  console.log(`  setMinter  ${setMinterTx}`);

  // Read the wiring back. The public RPC is load-balanced, so retry briefly.
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["dollar.minter", () => dollar.read.minter(), fund.address],
    ["dollar.administrator", () => dollar.read.administrator(), adminAddress],
    ["fund.administrator", () => fund.read.administrator(), adminAddress],
    ["fund.dollar", () => fund.read.dollar(), dollar.address],
    ["fund.registry", () => fund.read.registry(), registryAddress],
    ["fund.productId", () => fund.read.productId(), key],
  ];
  for (const [label, read, expected] of checks) {
    let actual = await read();
    for (let attempt = 1; attempt < 10 && actual.toLowerCase() !== expected.toLowerCase(); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      actual = await read();
    }
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`wiring failed: ${label} is ${actual}, expected ${expected}`);
    console.log(`  ok  ${label} = ${actual}`);
  }
  try {
    const [nav, effectiveAt] = await fund.read.currentNav();
    console.log(`  ok  fund.currentNav = ${nav} micros, recorded ${new Date(Number(effectiveAt) * 1000).toISOString()}`);
  } catch (error) {
    console.log(`  note  fund.currentNav is not available yet: ${(error as Error).message.split("\n")[0]}`);
  }

  deployment.contracts.GanymedeDemoDollar = { address: dollar.address, deployedAt: dollarDeployedAt, constructorArgs: [adminAddress] };
  deployment.contracts.GanymedeBasketFund = {
    address: fund.address,
    deployedAt: fundDeployedAt,
    productId: FUND_PRODUCT_ID,
    name: FUND_NAME,
    symbol: FUND_SYMBOL,
    constructorArgs: [...fundArgs],
  };
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
  console.log("next: npm run verify:export, then set the two addresses in lib/xstocks/fund.ts");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
