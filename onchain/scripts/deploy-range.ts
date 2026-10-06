/**
 * Deploys the USTX / dUSD pool where every liquidity provider holds positions of their own, on the
 * Uniswap v4 PoolManager already recorded for X Layer Testnet:
 *
 *   GanymedeRangeLiquidityHook  the pool, opened at the NAV of the recorded GanymedeNavFeed; positions
 *                               shaped Spot, Curve or Bid-Ask; deployed through the deterministic
 *                               deployment proxy at a CREATE2 address carrying its permissions
 *   GanymedeRangeArbitrage      brings the pool back to the NAV through the fund, for the keeper
 *
 * Then it seeds the pool from the administrator wallet with one position of each shape, so Pools
 * has liquidity to show and trades have liquidity to meet. Demo dollars and USTX have no value. The
 * user approved this deployment on 4 October 2026 (AGENTS.md asks for approval).
 *
 * With RANGE_REPLACE set to the recorded hook's address it replaces that hook, as on 6 October 2026
 * with the user's approval, when positions began to open only within the caller's tick limits: a new
 * hook and arbitrage, seeded the same way, then the administrator's seed positions in the replaced
 * hook closed. The record keeps the replaced hook under `replaced`. It refuses while another wallet
 * holds an open position in the replaced hook, since Pools reads only the recorded one; on chain, any
 * position there can still be closed at any NAV.
 *
 * On the in-process `hardhat` network it runs the same routine on a fork of X Layer Testnet with
 * the administrator impersonated, then rehearses a trade, a NAV move with the keeper's arbitrage,
 * and closing a position; nothing is broadcast and the record is not written.
 *
 * Run: npm run fork:range, then npm run deploy:range (each with RANGE_REPLACE=<recorded hook> to replace it)
 */
import hre from "hardhat";
import { writeFileSync } from "node:fs";
import { formatUnits, maxUint256, parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { RAILS, deploymentPath, loadDeployment } from "./_deployment";
import { CREATE2_PROXY, deployRangeLiquidity, navSqrtPriceX96, poolStateSlot, readSlot0, sqrtPriceToUsd } from "./_v4";

const ONE_SHARE = 1_000_000n;
const SHAPES = [
  { name: "Spot", shape: 0 },
  { name: "Curve", shape: 1 },
  { name: "Bid-Ask", shape: 2 },
] as const;
// Each seed position: bins of 20 ticks (0.2%), ten either side, $500 of USTX above and $500 of dUSD below.
const SEED_BIN_TICKS = 20;
const SEED_BINS = 10;
const SEED_SIDE_DOLLARS = 500_000_000n;
/** How far from the pool's opening tick a seed may open: nothing else trades a pool this new. */
const SEED_TICK_SLACK = 10;

async function main() {
  // `hardhat` forks in process and rehearses; `localhost` is a forked node (`npx hardhat node --fork …`)
  // left running with the pool deployed, for trying the app against it.
  const fork = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const rehearse = hre.network.name === "hardhat";
  const rail = RAILS.xlayerTestnet;
  if (!fork && hre.network.name !== "xlayerTestnet") throw new Error("Run on xlayerTestnet, on hardhat for the fork rehearsal, or on localhost for a forked node.");
  const deployment = loadDeployment(rail);
  const { GanymedeDemoDollar: dollarRecord, GanymedeBasketFund: fundRecord, GanymedeNavFeed: feedRecord, UniswapV4PoolManager: managerRecord, GanymedeV4Router: routerRecord } = deployment.contracts;
  if (!dollarRecord || !fundRecord || !feedRecord || !managerRecord || !routerRecord) throw new Error("The fund, NAV feed, pool manager and router must be recorded first.");
  const recorded = deployment.contracts.GanymedeRangeLiquidityHook;
  const replacing = recorded?.seedTransaction ? recorded : undefined;
  if (replacing && process.env.RANGE_REPLACE?.toLowerCase() !== replacing.address.toLowerCase()) {
    if (!fork) throw new Error(`A seeded range hook is already recorded at ${replacing.address}; set RANGE_REPLACE=${replacing.address} to replace it.`);
  }
  const replace = replacing && process.env.RANGE_REPLACE?.toLowerCase() === replacing.address.toLowerCase() ? replacing : undefined;

  if (fork) {
    if (rehearse) await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: process.env.XLAYER_RPC_URL || rail.rpcUrl } }] });
    await hre.network.provider.request({ method: "evm_mine", params: [] });
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [deployment.admin] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [deployment.admin, "0xde0b6b3a7640000"] });
  }
  const publicClient = await hre.viem.getPublicClient();
  const admin = fork ? await hre.viem.getWalletClient(deployment.admin as Address) : (await hre.viem.getWalletClients())[0];
  const adminAddress = admin.account.address;
  if (adminAddress.toLowerCase() !== deployment.admin.toLowerCase()) throw new Error(`ADMIN_PRIVATE_KEY is ${adminAddress}, but the recorded administrator is ${deployment.admin}.`);
  const chainId = await publicClient.getChainId();
  if (!fork && chainId !== rail.chainId) throw new Error(`RPC reports chain ${chainId}, expected ${rail.chainId}.`);

  const fundAddress = fundRecord.address as Address;
  const dollarAddress = dollarRecord.address as Address;
  const feedAddress = feedRecord.address as Address;
  const managerAddress = managerRecord.address as Address;
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", fundAddress);
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", dollarAddress);
  const feed = await hre.viem.getContractAt("GanymedeNavFeed", feedAddress);
  const [, answer, , updatedAt] = await feed.read.latestRoundData();
  const now = (await publicClient.getBlock()).timestamp;
  if (now - updatedAt > 1_800n) throw new Error(`The USTX NAV was recorded ${now - updatedAt} s ago; check the NAV record first.`);
  console.log(`${fork ? "fork of " : ""}${rail.name}, admin ${adminAddress}`);
  console.log(`pool manager ${managerAddress}, NAV ${formatUnits(answer, 8)} (${now - updatedAt} s old)\n`);
  if (replace) {
    // Pools reads only the recorded hook, so a position another wallet holds open in the replaced one
    // would drop out of its view. The replacement waits until there is none.
    const replaced = await hre.viem.getContractAt("GanymedeRangeLiquidityHook", replace.address as Address);
    const others: string[] = [];
    const next = await replaced.read.nextPositionId();
    for (let id = 1n; id < next; id += 1n) {
      const [owner, , , , , , open] = await replaced.read.positions([id]);
      if (open && owner.toLowerCase() !== adminAddress.toLowerCase()) others.push(`#${id} (${owner})`);
    }
    if (others.length) throw new Error(`Other wallets hold open positions in ${replace.address}: ${others.join(", ")}. Pools reads only the recorded hook, so replace it once they are closed.`);
  }

  let nonce = await publicClient.getTransactionCount({ address: adminAddress, blockTag: "pending" });
  let hookAddress = replace ? undefined : (recorded?.address as Address | undefined);
  let arbitrageAddress = replace ? undefined : (deployment.contracts.GanymedeRangeArbitrage?.address as Address | undefined);
  if (fork || !hookAddress || !arbitrageAddress) {
    const hookArtifact = await hre.artifacts.readArtifact("GanymedeRangeLiquidityHook");
    const arbitrageArtifact = await hre.artifacts.readArtifact("GanymedeRangeArbitrage");
    const deployed = await deployRangeLiquidity({
      wallet: admin, publicClient, nonce,
      hookArtifact: { abi: hookArtifact.abi, bytecode: hookArtifact.bytecode as Hex },
      arbitrageArtifact: { abi: arbitrageArtifact.abi, bytecode: arbitrageArtifact.bytecode as Hex },
      poolManager: managerAddress, asset: fundAddress, dollar: dollarAddress, feed: feedAddress,
      log: line => console.log(line),
    });
    nonce = deployed.nextNonce;
    hookAddress = deployed.hook.address;
    arbitrageAddress = deployed.arbitrage.address;
    if (!fork) {
      const deployedAt = new Date().toISOString();
      const hook = await hre.viem.getContractAt("GanymedeRangeLiquidityHook", hookAddress);
      const replaced = [
        ...(recorded?.replaced ?? []),
        ...(replace ? [{ address: replace.address, poolId: replace.poolId, deployedAt: replace.deployedAt, seedTransaction: replace.seedTransaction, arbitrage: deployment.contracts.GanymedeRangeArbitrage?.address, replacedAt: deployedAt }] : []),
      ];
      deployment.contracts.GanymedeRangeLiquidityHook = {
        address: hookAddress, deployedAt, deploymentTransaction: deployed.hook.hash, create2Deployer: CREATE2_PROXY, salt: deployed.hook.salt,
        poolId: await retry(() => hook.read.poolId(), value => /^0x[0-9a-f]{64}$/i.test(value)),
        constructorArgs: [managerAddress, fundAddress, dollarAddress, feedAddress],
        ...(replaced.length ? { replaced } : {}),
      };
      deployment.contracts.GanymedeRangeArbitrage = { address: arbitrageAddress, deployedAt, deploymentTransaction: deployed.arbitrage.hash, constructorArgs: [hookAddress, fundAddress] };
      writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
      console.log(`\nwrote ${deploymentPath(rail)} (not seeded yet)`);
    }
  } else {
    console.log(`resuming: the range hook at ${hookAddress} is recorded but not seeded`);
  }
  const hook = await hre.viem.getContractAt("GanymedeRangeLiquidityHook", hookAddress);
  const arbitrage = await hre.viem.getContractAt("GanymedeRangeArbitrage", arbitrageAddress);
  async function send(label: string, write: (options: { nonce: number; gas: bigint; account: typeof admin.account }) => Promise<Hash>, gas: bigint) {
    const hash = await write({ nonce: nonce++, gas, account: admin.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label.padEnd(30)} ${hash}  gas ${receipt.gasUsed}`);
    return receipt;
  }

  // Seed: USTX bought at the NAV for the bins above the price, demo dollars for the bins below.
  console.log("\nseeding one position of each shape...");
  const block = (await publicClient.getBlock()).timestamp;
  if ((await dollar.read.nextClaimAt([adminAddress])) <= block) await send("claim 10,000 dUSD", options => dollar.write.claim(options), 150_000n);
  const need = 2n * BigInt(SHAPES.length) * SEED_SIDE_DOLLARS;
  const balance = await retry(() => dollar.read.balanceOf([adminAddress]), value => value >= need);
  if (balance < need) throw new Error(`Admin holds ${balance} dUSD micros; seeding needs ${need}.`);
  const [nav] = await fund.read.currentNav();
  const investing = BigInt(SHAPES.length) * SEED_SIDE_DOLLARS;
  await send("approve fund", options => dollar.write.approve([fundAddress, investing], options), 80_000n);
  const invested = await send("invest at the NAV", options => fund.write.invest([investing, investing * ONE_SHARE / nav * 99n / 100n], options), 250_000n);
  const [issued] = parseEventLogs({ abi: fund.abi, logs: invested.logs, eventName: "Invested" });
  const perPosition = issued.args.shares / BigInt(SHAPES.length);
  await send("approve hook dUSD", options => dollar.write.approve([hookAddress!, maxUint256], options), 80_000n);
  await send("approve hook USTX", options => fund.write.approve([hookAddress!, maxUint256], options), 80_000n);
  const assetIsCurrency0 = BigInt(fundAddress) < BigInt(dollarAddress);
  const [amount0, amount1] = assetIsCurrency0 ? [perPosition, SEED_SIDE_DOLLARS] : [SEED_SIDE_DOLLARS, perPosition];
  let seedTransaction: Hash | undefined;
  const poolId = await hook.read.poolId();
  // Each seed opens only at the price the pool opened at, as the app asks of every provider.
  const { tick: seedTick } = await readSlot0(publicClient, managerAddress, poolId);
  for (const { name, shape } of SHAPES) {
    const deadline = (await publicClient.getBlock()).timestamp + 900n;
    const receipt = await send(`open ${name}`, options => hook.write.open([shape, SEED_BIN_TICKS, SEED_BINS, SEED_BINS, amount0, amount1, seedTick - SEED_TICK_SLACK, seedTick + SEED_TICK_SLACK, deadline], options), 4_500_000n);
    seedTransaction ??= receipt.transactionHash;
  }

  const slot = await readSlot0(publicClient, managerAddress, poolId);
  const [answerNow] = await hook.read.nav();
  console.log(`\n  pool price ${sqrtPriceToUsd(slot.sqrtPriceX96, assetIsCurrency0).toFixed(4)}, NAV ${formatUnits(answerNow, 8)}, ${(await hook.read.positionsOf([adminAddress])).length} positions`);
  if (slot.sqrtPriceX96 !== navSqrtPriceX96(answer, 8, 6, 6, assetIsCurrency0)) console.log("  (the pool opened at the NAV of its deployment block)");

  // The replaced hook's seed positions, the administrator's own, are closed; anyone else's stays theirs to close.
  const closeTransactions: Hash[] = [];
  if (replace) {
    console.log(`\nclosing the administrator's positions in the replaced hook ${replace.address}...`);
    const old = await hre.viem.getContractAt("GanymedeRangeLiquidityHook", replace.address as Address);
    for (const id of await old.read.positionsOf([adminAddress])) {
      const [, , , , , , open] = await old.read.positions([id]);
      if (!open) continue;
      const deadline = (await publicClient.getBlock()).timestamp + 900n;
      const receipt = await send(`close position ${id}`, options => old.write.close([id, 0n, 0n, deadline], options), 3_000_000n);
      closeTransactions.push(receipt.transactionHash);
    }
  }

  if (fork && !rehearse) {
    console.log(`\nforked node: hook ${hookAddress}, arbitrage ${arbitrageAddress}, pool ${await hook.read.poolId()}; nothing was broadcast to X Layer.`);
    return;
  }
  if (fork) {
    // Rehearse what the app and the keeper will do.
    const router = await hre.viem.getContractAt("GanymedeV4Router", routerRecord.address as Address);
    const key = await hook.read.poolKey();
    await send("approve router dUSD", options => dollar.write.approve([router.address, maxUint256], options), 80_000n);
    const deadline = (await publicClient.getBlock()).timestamp + 900n;
    await send("buy $200 of USTX", options => router.write.swapExactInput([key, !assetIsCurrency0, 200_000_000n, 0n, deadline], options), 600_000n);
    const registry = await hre.viem.getContractAt("GanymedeNavRegistry", deployment.contracts.GanymedeNavRegistry.address as Address);
    const publisher = await registry.read.publisher();
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [publisher] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [publisher, "0xde0b6b3a7640000"] });
    const productId = await fund.read.productId();
    const [, shares, holdings] = await registry.read.latestNav([productId]);
    await registry.write.publishNav([productId, nav * 101n / 100n, shares, holdings, (await publicClient.getBlock()).timestamp], { account: publisher });
    const { result: profit } = await arbitrage.simulate.arbitrage([0n], { account: adminAddress });
    await send("keeper arbitrage (NAV +1%)", options => arbitrage.write.arbitrage([0n], options), 1_500_000n);
    const after = await readSlot0(publicClient, managerAddress, poolId);
    console.log(`  arbitrage profit ${formatUnits(profit, 6)} dUSD; pool now ${sqrtPriceToUsd(after.sqrtPriceX96, assetIsCurrency0).toFixed(4)}`);
    const ids = await hook.read.positionsOf([adminAddress]);
    const [a0, a1, f0, f1] = await hook.read.positionAmounts([ids[2]]);
    console.log(`  Bid-Ask position: ${formatUnits(assetIsCurrency0 ? a0 : a1, 6)} USTX and ${formatUnits(assetIsCurrency0 ? a1 : a0, 6)} dUSD, fees ${formatUnits(assetIsCurrency0 ? f0 : f1, 6)} / ${formatUnits(assetIsCurrency0 ? f1 : f0, 6)}`);
    await send("close Bid-Ask", options => hook.write.close([ids[2], 0n, 0n, deadline], options), 3_000_000n);
    console.log("\nfork rehearsal passed; nothing was broadcast.");
    return;
  }

  deployment.contracts.GanymedeRangeLiquidityHook!.seedTransaction = seedTransaction;
  const history = deployment.contracts.GanymedeRangeLiquidityHook!.replaced;
  if (closeTransactions.length && history?.length) history[history.length - 1].closeTransactions = closeTransactions;
  writeFileSync(deploymentPath(rail), `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nwrote ${deploymentPath(rail)}`);
  const pin = {
    hook: hookAddress.toLowerCase(), arbitrage: arbitrageAddress.toLowerCase(), poolId: poolId.toLowerCase(), stateSlot: poolStateSlot(poolId as Hex),
  };
  console.log(`\nPin the pool in lib/xstocks/range-liquidity.ts:\n${JSON.stringify(pin, null, 2)}`);
  console.log("Then set RANGE_ARBITRAGE_ADDRESS in relayer/wrangler.keeper.jsonc so the keeper brings the pool to each NAV record.");
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
