/**
 * Deploys USTX liquidity on Uniswap v4 on X Layer Testnet, next to the fund and NAV feed the
 * earlier scripts recorded:
 *
 *   PoolManager                Uniswap v4-core 1.0.2 as Uniswap built it; owner = ADMIN. Uniswap has
 *                              deployed v4 on X Layer mainnet but not on X Layer Testnet.
 *   GanymedeRwaLiquidityHook   the USTX / dUSD pool, opened at the NAV of the recorded
 *                              GanymedeNavFeed, and the vault of its liquidity providers; deployed
 *                              through the deterministic deployment proxy at a CREATE2 address
 *                              whose low bits carry its permissions
 *   GanymedeV4Router           swaps on the pool for the app and a keeper
 *
 * It records the three contracts as soon as they are deployed, then seeds the pool from the
 * administrator wallet: claim 10,000 demo dollars, invest SEED_DOLLARS at the fund and deposit the
 * USTX it issued with the same value in demo dollars. A run that stops after the deployment resumes
 * at the seed.
 * Demo dollars and USTX have no value. Deploying needs the user's approval (AGENTS.md);
 * `npm run fork:v4` runs the same deployment routine on a fork of X Layer Testnet first.
 *
 * The public RPC is load-balanced and a node can lag behind the last receipt, so every transaction
 * carries its own nonce and gas limit.
 *
 * Run: npm run deploy:v4
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import { parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { deploymentPath, loadDeployment, railFor } from "./_deployment";
import { CREATE2_PROXY, deployRwaLiquidity, navSqrtPriceX96, poolStateSlot, readSlot0 } from "./_v4";

const SEED_DOLLARS = 5_000_000_000n; // $5,000 of USTX, plus the same in demo dollars
const ONE_SHARE = 1_000_000n;
const LP_NAME = "Ganymede USTX-dUSD v4 LP";
const LP_SYMBOL = "USTX-V4LP";

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The Uniswap v4 pool is deployed on X Layer Testnet only.");
  const deployment = loadDeployment(rail);
  const { GanymedeDemoDollar: dollarRecord, GanymedeBasketFund: fundRecord, GanymedeNavFeed: feedRecord, GanymedeRwaLiquidityHook: existing } = deployment.contracts;
  if (!dollarRecord || !fundRecord || !feedRecord) throw new Error("No fund and NAV feed are recorded. Run `npm run deploy:fund` and `npm run deploy:feed` first.");
  if (existing?.seedTransaction) throw new Error(`A seeded hook is already recorded at ${existing.address}. Remove it from the record to redeploy.`);
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
  const feedAddress = feedRecord.address as Address;
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", fundAddress);
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", dollarAddress);
  const feed = await hre.viem.getContractAt("GanymedeNavFeed", feedAddress);
  // The hook opens its pool at the NAV and refuses one over an hour old.
  const [, answer, , updatedAt] = await feed.read.latestRoundData();
  const age = BigInt(Math.floor(Date.now() / 1000)) - updatedAt;
  if (age > 1_800n) throw new Error(`The USTX NAV was recorded ${age} s ago; check the NAV record before deploying.`);
  console.log(`network      ${rail.name} (chainId ${chainId})`);
  console.log(`admin        ${adminAddress}`);
  console.log(`USTX fund    ${fundAddress}`);
  console.log(`dUSD         ${dollarAddress}`);
  console.log(`NAV feed     ${feedAddress}  (answer ${answer}, ${age} s old)\n`);

  let nonce: number;
  if (existing) {
    // An earlier run deployed and recorded the contracts but stopped before the seed: seed them now.
    const { UniswapV4PoolManager: manager, GanymedeV4Router: router } = deployment.contracts;
    if (!manager || !router) throw new Error("The hook is recorded without its pool manager and router; fix the record by hand.");
    console.log(`resuming: the hook at ${existing.address} is recorded but not seeded`);
    nonce = await publicClient.getTransactionCount({ address: adminAddress, blockTag: "pending" });
  } else {
    console.log("deploying...");
    const hookArtifact = await hre.artifacts.readArtifact("GanymedeRwaLiquidityHook");
    const routerArtifact = await hre.artifacts.readArtifact("GanymedeV4Router");
    const deployed = await deployRwaLiquidity({
      wallet: admin,
      publicClient,
      hookArtifact: { abi: hookArtifact.abi, bytecode: hookArtifact.bytecode as Hex },
      routerArtifact: { abi: routerArtifact.abi, bytecode: routerArtifact.bytecode as Hex },
      asset: fundAddress,
      dollar: dollarAddress,
      feed: feedAddress,
      name: LP_NAME,
      symbol: LP_SYMBOL,
      log: line => console.log(line),
    });
    if (!("hash" in deployed.poolManager)) throw new Error("expected a new pool manager");
    // Record the contracts before seeding, so a failure while seeding resumes here instead of deploying again.
    const deployedAt = new Date().toISOString();
    const hookContract = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", deployed.hook.address);
    deployment.contracts.UniswapV4PoolManager = {
      address: deployed.poolManager.address,
      deployedAt,
      deploymentTransaction: deployed.poolManager.hash,
      source: "@uniswap/v4-core 1.0.2 out/PoolManager.sol (Uniswap's build: solc 0.8.26, via IR, Cancun)",
      constructorArgs: [adminAddress],
    };
    deployment.contracts.GanymedeRwaLiquidityHook = {
      address: deployed.hook.address,
      deployedAt,
      deploymentTransaction: deployed.hook.hash,
      create2Deployer: CREATE2_PROXY,
      salt: deployed.hook.salt,
      poolId: await retry(() => hookContract.read.poolId(), value => /^0x[0-9a-f]{64}$/i.test(value)),
      constructorArgs: [deployed.poolManager.address, fundAddress, dollarAddress, feedAddress, LP_NAME, LP_SYMBOL],
    };
    deployment.contracts.GanymedeV4Router = {
      address: deployed.router.address,
      deployedAt,
      deploymentTransaction: deployed.router.hash,
      constructorArgs: [deployed.poolManager.address],
    };
    writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
    console.log(`\nwrote ${deploymentPath(rail)} (not seeded yet)`);
    nonce = deployed.nextNonce;
  }
  const hookRecord = deployment.contracts.GanymedeRwaLiquidityHook!;
  const poolManagerAddress = deployment.contracts.UniswapV4PoolManager!.address as Address;
  const routerAddress = deployment.contracts.GanymedeV4Router!.address as Address;
  const hook = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", hookRecord.address as Address);
  async function send(label: string, write: (options: { nonce: number; gas: bigint }) => Promise<Hash>, gas: bigint) {
    const hash = await write({ nonce: nonce++, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label.padEnd(26)} ${hash}  gas ${receipt.gasUsed}`);
    return receipt;
  }

  const assetIsCurrency0 = BigInt(fundAddress) < BigInt(dollarAddress);
  let seed: { blockNumber: bigint; transactionHash: Hash };
  if ((await hook.read.totalSupply()) > 0n) {
    // Seeded by a run that stopped before recording it: find the administrator's deposit in the blocks
    // after the deployment. Anyone may deposit first; the checks below confirm it was the seed.
    const deployedIn = (await publicClient.getTransactionReceipt({ hash: hookRecord.deploymentTransaction as Hash })).blockNumber;
    const [first] = await publicClient.getContractEvents({
      address: hook.address, abi: hook.abi, eventName: "Deposited", args: { account: adminAddress }, fromBlock: deployedIn, toBlock: deployedIn + 99n,
    });
    if (!first) throw new Error("The hook holds liquidity but no deposit from the administrator is in the 100 blocks after its deployment; check it and record seedTransaction by hand.");
    seed = { blockNumber: first.blockNumber, transactionHash: first.transactionHash };
    console.log(`\nalready seeded in ${seed.transactionHash}`);
  } else {
    console.log("\nseeding the pool at the NAV...");
    const now = BigInt(Math.floor(Date.now() / 1000));
    if ((await dollar.read.nextClaimAt([adminAddress])) <= now) {
      await send("claim 10,000 dUSD", options => dollar.write.claim({ account: admin.account, ...options }), 150_000n);
    }
    const balance = await retry(() => dollar.read.balanceOf([adminAddress]), value => value >= 2n * SEED_DOLLARS);
    if (balance < 2n * SEED_DOLLARS) throw new Error(`Admin holds ${balance} dUSD micros; seeding needs ${2n * SEED_DOLLARS}.`);
    // A NAV record can land between this read and the investment: allow 1%, then deposit what the fund issued.
    const [nav] = await fund.read.currentNav();
    const expected = (SEED_DOLLARS * ONE_SHARE) / nav;
    await send("approve fund", options => dollar.write.approve([fundAddress, SEED_DOLLARS], { account: admin.account, ...options }), 80_000n);
    const invested = await send("invest at the NAV", options => fund.write.invest([SEED_DOLLARS, expected * 99n / 100n], { account: admin.account, ...options }), 250_000n);
    const [issued] = parseEventLogs({ abi: fund.abi, logs: invested.logs, eventName: "Invested" });
    if (!issued) throw new Error(`The investment ${invested.transactionHash} issued no USTX.`);
    const shares = issued.args.shares;
    await send("approve hook dUSD", options => dollar.write.approve([hook.address, SEED_DOLLARS], { account: admin.account, ...options }), 80_000n);
    await send("approve hook USTX", options => fund.write.approve([hook.address, shares], { account: admin.account, ...options }), 80_000n);
    const [amount0, amount1] = assetIsCurrency0 ? [shares, SEED_DOLLARS] : [SEED_DOLLARS, shares];
    // The first deposit mints its value at the NAV, less 1,000 locked shares, and opens the ranges.
    seed = await send(
      "first deposit",
      options => hook.write.deposit([amount0, amount1, now + 900n], { account: admin.account, ...options }),
      900_000n,
    );
  }

  // Read the result back at the seeding block.
  const at = { blockNumber: seed.blockNumber };
  const [answerAt] = await hook.read.nav(at);
  const key = await hook.read.poolKey(at);
  const checks: Array<[string, () => Promise<string>, string]> = [
    ["hook.poolManager", () => hook.read.poolManager(at), poolManagerAddress],
    ["hook.asset", () => hook.read.asset(at), fundAddress],
    ["hook.dollar", () => hook.read.dollar(at), dollarAddress],
    ["hook.navFeed", () => hook.read.navFeed(at), feedAddress],
    ["poolKey.hooks", async () => key.hooks, hook.address],
    [
      "pool price",
      async () => String((await readSlot0(publicClient, poolManagerAddress, await hook.read.poolId(), seed.blockNumber)).sqrtPriceX96),
      String(navSqrtPriceX96(answerAt, 8, 6, 6, assetIsCurrency0)),
    ],
    ["LP holder", async () => String((await hook.read.balanceOf([adminAddress], at)) > 0n), "true"],
  ];
  for (const [label, read, expected] of checks) {
    const actual = await retry(read, value => value.toLowerCase() === expected.toLowerCase());
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`wiring failed: ${label} is ${actual}, expected ${expected}`);
    console.log(`  ok  ${label} = ${actual}`);
  }

  hookRecord.seedTransaction = seed.transactionHash;
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
  // The app shows the pool on Pools once it is pinned; onchain/test/AppV4Client.test.ts checks the pin against this record.
  const pin = {
    poolManager: poolManagerAddress.toLowerCase(),
    hook: hook.address.toLowerCase(),
    router: routerAddress.toLowerCase(),
    asset: fundAddress.toLowerCase(),
    dollar: dollarAddress.toLowerCase(),
    assetIsCurrency0,
    poolId: (hookRecord.poolId as string).toLowerCase(),
    stateSlot: poolStateSlot(hookRecord.poolId as Hex),
  };
  console.log(`\nPin the pool in lib/xstocks/v4-liquidity.ts:\n\nexport const V4_POOL_DEPLOYMENT: V4Deployment | null = ${JSON.stringify(pin, null, 2)};`);
  console.log("Then set V4_HOOK_ADDRESS in relayer/wrangler.keeper.jsonc so the keeper moves the pool to each NAV record.");
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
