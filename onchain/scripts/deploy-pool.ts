/**
 * Deploys the USTX secondary market on X Layer Testnet, next to the fund that
 * `npm run deploy:fund` recorded, and seeds it at the NAV:
 *
 *   GanymedeUstxPool       USTX / dUSD constant-product pool, 0.3% fee to liquidity providers
 *   GanymedeNavArbitrage   closes the pool's gap to the NAV through the fund in one transaction
 *
 * Seeding, from the administrator wallet: claim 10,000 demo dollars, invest
 * SEED_DOLLARS at the fund, and add the USTX received with the same value in
 * demo dollars, so the pool opens at the NAV. Demo dollars and USTX have no value.
 *
 * The public RPC is load-balanced and a node can lag behind the last receipt, so
 * each transaction carries its own nonce and gas limit instead of asking a node.
 *
 * Run: npm run deploy:pool
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import type { Abi, Address, Hash, Hex } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";

const SEED_DOLLARS = 5_000_000_000n; // $5,000 of USTX, plus the same in demo dollars
const ONE_SHARE = 1_000_000n;

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The USTX pool is deployed on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  const { GanymedeDemoDollar: dollarRecord, GanymedeBasketFund: fundRecord, GanymedeUstxPool: existing } = deployment.contracts;
  if (!dollarRecord || !fundRecord) throw new Error("No fund is recorded. Run `npm run deploy:fund` first.");
  if (existing) throw new Error(`A pool is already recorded at ${existing.address}. Remove it from the record to redeploy.`);
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

  const fundAddress = fundRecord.address as Address;
  const dollarAddress = dollarRecord.address as Address;
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", fundAddress);
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", dollarAddress);
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`USTX fund    ${fundAddress}`);
  console.log(`dUSD         ${dollarAddress}\n`);

  let nonce = await publicClient.getTransactionCount({ address: adminAddress, blockTag: "pending" });
  async function confirm(label: string, hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label.padEnd(22)} ${hash}`);
    return receipt;
  }
  async function deploy(name: "GanymedeUstxPool" | "GanymedeNavArbitrage", args: readonly [Address], gas: bigint) {
    const artifact = await hre.artifacts.readArtifact(name);
    const hash = await admin.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: [...args], nonce: nonce++, gas });
    const receipt = await confirm(`deploy ${name}`, hash);
    if (!receipt.contractAddress) throw new Error(`no contract address for ${name}`);
    return { address: receipt.contractAddress, hash, deployedAt: new Date().toISOString() };
  }
  async function send(label: string, write: (options: { nonce: number; gas: bigint }) => Promise<Hash>, gas: bigint) {
    return confirm(label, await write({ nonce: nonce++, gas }));
  }

  console.log("deploying...");
  const poolDeployment = await deploy("GanymedeUstxPool", [fundAddress], 1_600_000n);
  // The arbitrage constructor reads the pool, so wait until the RPC serves its code.
  await retry(async () => ((await publicClient.getCode({ address: poolDeployment.address })) ?? "0x") !== "0x", ok => ok);
  const arbitrageDeployment = await deploy("GanymedeNavArbitrage", [poolDeployment.address], 1_200_000n);
  const pool = await hre.viem.getContractAt("GanymedeUstxPool", poolDeployment.address);

  console.log("\nseeding the pool at the NAV...");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if ((await dollar.read.nextClaimAt([adminAddress])) <= now) {
    await send("claim 10,000 dUSD", options => dollar.write.claim({ account: admin.account, ...options }), 150_000n);
  }
  const [nav] = await fund.read.currentNav();
  const expectedShares = (SEED_DOLLARS * ONE_SHARE) / nav;
  const seedDollars = (expectedShares * nav) / ONE_SHARE;
  const balance = await retry(() => dollar.read.balanceOf([adminAddress]), value => value >= SEED_DOLLARS + seedDollars);
  if (balance < SEED_DOLLARS + seedDollars) throw new Error(`Admin holds ${balance} dUSD micros; seeding needs ${SEED_DOLLARS + seedDollars}.`);
  await send("approve fund", options => dollar.write.approve([fundAddress, SEED_DOLLARS], { account: admin.account, ...options }), 80_000n);
  await send("invest at the NAV", options => fund.write.invest([SEED_DOLLARS, expectedShares], { account: admin.account, ...options }), 250_000n);
  await send("approve pool dUSD", options => dollar.write.approve([pool.address, seedDollars], { account: admin.account, ...options }), 80_000n);
  await send("approve pool USTX", options => fund.write.approve([pool.address, expectedShares], { account: admin.account, ...options }), 80_000n);
  const seed = await send(
    "add liquidity",
    options => pool.write.addLiquidity([expectedShares, seedDollars, expectedShares, seedDollars, now + 900n], { account: admin.account, ...options }),
    350_000n,
  );

  // Read the result back at the seeding block.
  const at = { blockNumber: seed.blockNumber };
  const arbitrage = await hre.viem.getContractAt("GanymedeNavArbitrage", arbitrageDeployment.address);
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["pool.fund", () => pool.read.fund(at), fundAddress],
    ["pool.dollar", () => pool.read.dollar(at), dollarAddress],
    ["arbitrage.pool", () => arbitrage.read.pool(at), pool.address],
    ["arbitrage.fund", () => arbitrage.read.fund(at), fundAddress],
    ["pool.reserves", async () => (await pool.read.getReserves(at)).join("/"), `${expectedShares}/${seedDollars}`],
  ];
  for (const [label, read, expected] of checks) {
    const actual = await retry(read, value => value.toLowerCase() === expected.toLowerCase());
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`wiring failed: ${label} is ${actual}, expected ${expected}`);
    console.log(`  ok  ${label} = ${actual}`);
  }
  console.log(`  pool price ${await pool.read.price(at)} micros per USTX; NAV ${nav}`);

  deployment.contracts.GanymedeUstxPool = {
    address: poolDeployment.address,
    deployedAt: poolDeployment.deployedAt,
    deploymentTransaction: poolDeployment.hash,
    seedTransaction: seed.transactionHash,
    constructorArgs: [fundAddress],
  };
  deployment.contracts.GanymedeNavArbitrage = {
    address: arbitrageDeployment.address,
    deployedAt: arbitrageDeployment.deployedAt,
    deploymentTransaction: arbitrageDeployment.hash,
    constructorArgs: [poolDeployment.address],
  };
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
}

async function retry<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  if (last !== undefined) return last;
  throw lastError;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
