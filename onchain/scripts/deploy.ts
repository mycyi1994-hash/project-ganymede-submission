/**
 * Deploys the Ganymede settlement contracts to a settlement rail (X Layer
 * testnet by default) and hands the hot-key roles to the relayer.
 *
 * Role wiring performed here:
 *
 *   GanymedeFundShare    administrator = ADMIN   (constructor)
 *                        transferAgent = ADMIN   (constructor, left as-is)
 *                        issuer        = RELAYER (setIssuer, this script)
 *
 *   GanymedeNavRegistry  administrator = ADMIN   (constructor)
 *                        publisher     = RELAYER (constructor)
 *
 * transferAgent stays on the cold key on purpose: allowlisting an investor is a
 * compliance decision, not something an internet-facing relayer should be able
 * to do. The relayer can mint, burn and publish. Nothing else.
 *
 * Run: npm run deploy          (X Layer testnet)
 *      npm run deploy:giwa     (GIWA Sepolia)
 */
import hre from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deploymentPath, railFor } from "./_deployment";

const FUND_NAME = process.env.FUND_SHARE_NAME ?? "Ganymede Core 20";
const FUND_SYMBOL = process.env.FUND_SHARE_SYMBOL ?? "GMDCORE";

// Which engine product this share ledger represents. Must match a product id in
// lib/engine/seed.ts — the relayer maps productId -> share contract with it.
const FUND_PRODUCT_ID = process.env.FUND_SHARE_PRODUCT_ID ?? "core-20";

async function main() {
  const rail = railFor(hre.network.name);
  const clients = await hre.viem.getWalletClients();
  if (clients.length < 2) {
    throw new Error(
      "Two accounts required. Set ADMIN_PRIVATE_KEY and RELAYER_PRIVATE_KEY in onchain/.env — " +
        `got ${clients.length}.`,
    );
  }
  const [admin, relayer] = clients;
  const publicClient = await hre.viem.getPublicClient();

  const adminAddress = admin.account.address;
  const relayerAddress = relayer.account.address;
  if (adminAddress.toLowerCase() === relayerAddress.toLowerCase()) {
    throw new Error("ADMIN and RELAYER must be different keys — role separation is the security model.");
  }

  const adminBalance = await publicClient.getBalance({ address: adminAddress });
  if (adminBalance === 0n) {
    throw new Error(`Admin ${adminAddress} has no ${rail.name} ${rail.gasToken}. Fund it from the faucet first.`);
  }

  const chainId = await publicClient.getChainId();
  if (chainId !== rail.chainId) {
    throw new Error(`RPC reports chain ${chainId}, expected ${rail.name} (${rail.chainId}).`);
  }
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`relayer      ${relayerAddress}\n`);

  console.log("deploying GanymedeFundShare...");
  const fundShare = await hre.viem.deployContract(
    "GanymedeFundShare",
    [FUND_NAME, FUND_SYMBOL, adminAddress],
    { client: { wallet: admin } },
  );
  console.log(`  ${fundShare.address}`);

  console.log("deploying GanymedeNavRegistry...");
  const navRegistry = await hre.viem.deployContract(
    "GanymedeNavRegistry",
    [adminAddress, relayerAddress],
    { client: { wallet: admin } },
  );
  console.log(`  ${navRegistry.address}`);

  console.log("\nhanding issuance to the relayer key...");
  const setIssuerTx = await fundShare.write.setIssuer([relayerAddress], { account: admin.account });
  const setIssuerReceipt = await publicClient.waitForTransactionReceipt({ hash: setIssuerTx });
  if (setIssuerReceipt.status !== "success") throw new Error(`setIssuer reverted: ${setIssuerTx}`);
  console.log(`  setIssuer  ${setIssuerTx}`);

  // Verify the wiring landed rather than trusting the receipts. The public RPC
  // is load-balanced, so a read right after a receipt can land on a node that
  // has not seen that block yet: retry for a few seconds before failing.
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["fundShare.issuer", () => fundShare.read.issuer(), relayerAddress],
    ["fundShare.administrator", () => fundShare.read.administrator(), adminAddress],
    ["fundShare.transferAgent", () => fundShare.read.transferAgent(), adminAddress],
    ["navRegistry.publisher", () => navRegistry.read.publisher(), relayerAddress],
  ];
  for (const [label, read, expected] of checks) {
    let actual = await read();
    for (let attempt = 1; attempt < 10 && actual.toLowerCase() !== expected.toLowerCase(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      actual = await read();
    }
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`role wiring failed: ${label} is ${actual}, expected ${expected}`);
    }
    console.log(`  ok  ${label} = ${actual}`);
  }

  const record = {
    chainId: rail.chainId,
    network: rail.key,
    explorer: rail.explorer,
    deployedAt: new Date().toISOString(),
    admin: adminAddress,
    relayer: relayerAddress,
    contracts: {
      GanymedeFundShare: {
        address: fundShare.address,
        productId: FUND_PRODUCT_ID,
        name: FUND_NAME,
        symbol: FUND_SYMBOL,
        constructorArgs: [FUND_NAME, FUND_SYMBOL, adminAddress],
      },
      GanymedeNavRegistry: {
        address: navRegistry.address,
        constructorArgs: [adminAddress, relayerAddress],
      },
    },
  };

  const outFile = deploymentPath(rail);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nwrote ${outFile}\n`);
  console.log("── next: verify the sources on the explorer ──────────────────");
  console.log(
    `npx hardhat verify --network ${hre.network.name} ${fundShare.address} ` +
      `"${FUND_NAME}" "${FUND_SYMBOL}" ${adminAddress}`,
  );
  console.log(
    `npx hardhat verify --network ${hre.network.name} ${navRegistry.address} ` +
      `${adminAddress} ${relayerAddress}`,
  );
  console.log("\n── then: put these in the app's and the relayer's env ───────");
  console.log(`SETTLEMENT_CHAIN=${rail.key}`);
  console.log(`FUND_SHARE_ADDRESS=${fundShare.address}`);
  console.log(`NAV_REGISTRY_ADDRESS=${navRegistry.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
