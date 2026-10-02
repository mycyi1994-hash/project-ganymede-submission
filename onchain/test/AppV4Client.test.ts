import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, keccak256, maxUint256, toBytes, toEventSelector, toFunctionSelector, type AbiItem, type Address, type Hex } from "viem";
import { productKey, toBytes32 } from "../../relayer/src/ids";
import { type FundReceipt } from "../../lib/xstocks/fund";
import { V4_SWAP_TOPIC, applyEvents, type LpMarkout } from "../../lib/xstocks/lp-markout";
import {
  V4_ERRORS, V4_EVENTS, V4_POOL_DEPLOYMENT, V4_SELECTORS, V4_SWAPPED_TOPIC, readV4Quote, v4SwapCalls, v4SwapFill, isPinnedToFund, readV4Pool, v4Calls, v4DepositQuote, v4ErrorMessage, v4Fill, v4PairedDollars, v4ValueMicros,
  v4WithdrawEstimate,
  type V4Deployment,
} from "../../lib/xstocks/v4-liquidity";
import { CREATE2_PROXY, CREATE2_PROXY_CODE, DYNAMIC_FEE_FLAG, deployRwaLiquidity, poolIdOf, poolManagerArtifact, poolStateSlot } from "../scripts/_v4";

// The app carries no keccak, so lib/xstocks/v4-liquidity.ts hard-codes the hook's selectors, events
// and errors. These checks tie them to the compiled hook and run the app's own calldata and reads
// against a local PoolManager and hook, the way it will run once the pool is deployed.

const USD = 1_000_000n;
const USTX = productKey("us-tech-x");
const signature = (item: { name: string; inputs: readonly { type: string }[] }) => `${item.name}(${item.inputs.map(input => input.type).join(",")})`;
/** The app's RPC shape, answered by the Hardhat network, which reports X Layer Testnet's chain id. */
const appRpc = (method: string, params: unknown[]) => method === "eth_chainId" ? Promise.resolve("0x7a0") : hre.network.provider.request({ method, params });
const withSlippage = (amount: bigint) => amount * 99n / 100n;

describe("App v4 pool client", () => {
  it("uses the selectors, events and errors of the compiled hook and router", async () => {
    const hook = (await hre.artifacts.readArtifact("GanymedeRwaLiquidityHook")).abi as readonly AbiItem[];
    const router = (await hre.artifacts.readArtifact("GanymedeV4Router")).abi as readonly AbiItem[];
    const manager = poolManagerArtifact().abi as readonly AbiItem[];
    const functions = new Set([...hook, ...manager, ...router].filter(item => item.type === "function").map(item => toFunctionSelector(item as never)));
    for (const [name, selector] of Object.entries(V4_SELECTORS)) expect(functions.has(selector), name).to.equal(true);
    const events = hook.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    const topic = (name: string) => toEventSelector(signature(events.find(item => item.name === name)!));
    expect(V4_EVENTS).to.deep.equal({
      deposited: topic("Deposited"), depositCancelled: topic("DepositCancelled"), converted: topic("Converted"), sharesClaimed: topic("SharesClaimed"),
      withdrawn: topic("Withdrawn"), repegged: topic("Repegged"), transfer: topic("Transfer"),
    });
    const managerEvents = manager.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    expect(V4_SWAP_TOPIC).to.equal(toEventSelector(signature(managerEvents.find(item => item.name === "Swap")!)));
    const routerEvents = router.filter(item => item.type === "event") as unknown as Array<{ name: string; inputs: { type: string }[] }>;
    expect(V4_SWAPPED_TOPIC).to.equal(toEventSelector(signature(routerEvents.find(item => item.name === "Swapped")!)));
    const errors = new Set([...hook, ...router].filter(item => item.type === "error").map(item => keccak256(toBytes(signature(item as never))).slice(0, 10)));
    for (const selector of Object.keys(V4_ERRORS)) expect(errors.has(selector), selector).to.equal(true);
  });

  it("deposits, waits for the NAV record, converts, claims and withdraws with the app's calls", async () => {
    const [admin, relayer, provider, quitter, keeper] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const registry = await hre.viem.deployContract("GanymedeNavRegistry", [admin.account.address, relayer.account.address]);
    const dollar = await hre.viem.deployContract("GanymedeDemoDollar", [admin.account.address]);
    const fund = await hre.viem.deployContract("GanymedeBasketFund", ["Ganymede US Tech Basket", "USTX", dollar.address, registry.address, USTX, admin.account.address]);
    await dollar.write.setMinter([fund.address]);
    const feed = await hre.viem.deployContract("GanymedeNavFeed", [registry.address, USTX, "USTX / USD"]);
    const publish = async (nav: bigint) => {
      await time.increase(60);
      await registry.write.publishNav([USTX, nav, 0n, toBytes32("11".repeat(32)), BigInt(await time.latest())], { account: relayer.account });
    };
    await publish(100n * USD);
    await hre.network.provider.request({ method: "hardhat_setCode", params: [CREATE2_PROXY, CREATE2_PROXY_CODE] });
    const hookArtifact = await hre.artifacts.readArtifact("GanymedeRwaLiquidityHook");
    const routerArtifact = await hre.artifacts.readArtifact("GanymedeV4Router");
    const deployed = await deployRwaLiquidity({
      wallet: admin, publicClient,
      hookArtifact: { abi: hookArtifact.abi, bytecode: hookArtifact.bytecode as Hex },
      routerArtifact: { abi: routerArtifact.abi, bytecode: routerArtifact.bytecode as Hex },
      asset: fund.address, dollar: dollar.address, feed: feed.address, name: "Ganymede USTX-dUSD v4 LP", symbol: "USTX-V4LP",
    });
    const assetIsCurrency0 = BigInt(fund.address) < BigInt(dollar.address);
    const poolId = poolIdOf({
      currency0: getAddress(assetIsCurrency0 ? fund.address : dollar.address), currency1: getAddress(assetIsCurrency0 ? dollar.address : fund.address),
      fee: DYNAMIC_FEE_FLAG, tickSpacing: 10, hooks: getAddress(deployed.hook.address),
    });
    // What `npm run deploy:v4` records and the app pins.
    const deployment: V4Deployment = {
      poolManager: deployed.poolManager.address.toLowerCase(), hook: deployed.hook.address.toLowerCase(), router: deployed.router.address.toLowerCase(),
      asset: fund.address.toLowerCase(), dollar: dollar.address.toLowerCase(), assetIsCurrency0, poolId: poolId.toLowerCase(), stateSlot: poolStateSlot(poolId),
    };
    const hook = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", deployed.hook.address);
    expect(await hook.read.poolId()).to.equal(poolId);
    const calls = v4Calls(deployment);
    const send = async (wallet: typeof admin, request: { to: string; data: string }) => {
      const hash = await wallet.sendTransaction({ to: request.to as Address, data: request.data as Hex });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      return { hash, block: Number(receipt.blockNumber), status: "success", logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics], data: log.data })) } as FundReceipt;
    };
    const deadline = async () => Number(await time.latest()) + 600;
    for (const wallet of [admin, provider, quitter]) {
      await dollar.write.claim({ account: wallet.account });
      await dollar.write.approve([fund.address, maxUint256], { account: wallet.account });
      await fund.write.invest([1_000n * USD, 0n], { account: wallet.account });
    }
    await fund.write.invest([4_000n * USD, 0n]);

    // The first deposit, as the deployment seeds it: both amounts in full, LP tokens at once.
    let { pool } = await readV4Pool(deployment, null, { rpc: appRpc });
    expect([pool.supply, pool.nav.answer]).to.deep.equal([0n, 100n * 100_000_000n]);
    // 0.30%, rising by 0.70% over the record's hour: the deployment took some seconds of it.
    expect(pool.feePips! >= 3_000 && pool.feePips! < 3_100, `fee ${pool.feePips}`).to.equal(true);
    const seed = { sharesMicros: 50n * USD, dollarsMicros: 5_000n * USD };
    const opening = v4DepositQuote(seed, pool)!;
    await send(admin, calls.approveShares(seed.sharesMicros));
    await send(admin, calls.approveDollars(seed.dollarsMicros));
    const seeded = v4Fill(await send(admin, calls.deposit(seed, await deadline())), deployment, admin.account.address);
    expect(seeded.mintedLpMicros).to.equal(opening.lpEstimateMicros);
    expect(seeded.deposited).to.deep.include(seed);

    // The pool opened at the NAV; the app reads it, by token, and a wallet with nothing in it.
    ({ pool } = await readV4Pool(deployment, provider.account.address, { rpc: appRpc }));
    expect(pool.priceMicros > 99_990_000n && pool.priceMicros < 100_010_000n, `price ${pool.priceMicros}`).to.equal(true);
    expect(pool.epoch).to.equal(1n);
    expect(pool.base.lower < pool.base.upper && pool.base.liquidity > 0n).to.equal(true);
    // What the LP tokens own is the seed valued at the NAV, less the pool manager's rounding when the
    // ranges were added and as it would pay them out: about a hundredth of a cent.
    const held = v4ValueMicros(pool, pool.nav.answer!);
    expect(held <= 10_000n * USD && 10_000n * USD - held <= 1_000n, `held ${held}`).to.equal(true);

    // A provider types 3 USTX: the app pairs demo dollars at the holdings' ratio, and the hook takes exactly the quote.
    const dollars = v4PairedDollars(3n * USD, pool)!;
    const quote = v4DepositQuote({ sharesMicros: 3n * USD, dollarsMicros: dollars }, pool)!;
    await send(provider, calls.approveShares(3n * USD));
    await send(provider, calls.approveDollars(dollars));
    const deposited = v4Fill(await send(provider, calls.deposit({ sharesMicros: 3n * USD, dollarsMicros: dollars }, await deadline())), deployment, provider.account.address);
    expect(deposited.deposited).to.deep.equal({ sharesMicros: quote.sharesMicros, dollarsMicros: quote.dollarsMicros, epoch: 1n });
    expect(deposited.mintedLpMicros).to.equal(0n, "a later deposit waits for the next NAV record");
    let account = (await readV4Pool(deployment, provider.account.address, { rpc: appRpc })).account!;
    expect(account.waiting).to.deep.equal({ sharesMicros: quote.sharesMicros, dollarsMicros: quote.dollarsMicros });
    expect(account.claimableLpMicros).to.equal(0n);

    // Another changes their mind before the record: cancelling returns the deposit in full.
    const before = await fund.read.balanceOf([quitter.account.address]);
    await send(quitter, calls.approveShares(maxUint256));
    await send(quitter, calls.approveDollars(maxUint256));
    const waiting = v4Fill(await send(quitter, calls.deposit({ sharesMicros: USD, dollarsMicros: v4PairedDollars(USD, pool)! }, await deadline())), deployment, quitter.account.address).deposited!;
    expect(v4Fill(await send(quitter, calls.cancelDeposit()), deployment, quitter.account.address).cancelled).to.deep.equal({ sharesMicros: waiting.sharesMicros, dollarsMicros: waiting.dollarsMicros });
    expect(await fund.read.balanceOf([quitter.account.address])).to.equal(before);
    // Nothing left to cancel: the app explains the revert.
    const nothing = await quitter.sendTransaction({ to: calls.cancelDeposit().to as Address, data: calls.cancelDeposit().data as Hex }).catch(error => error);
    expect(v4ErrorMessage(nothing)).to.match(/No deposit is waiting/);

    // The next NAV record: anyone's re-peg converts the waiting deposit at that NAV.
    await publish(101n * USD);
    ({ pool } = await readV4Pool(deployment, provider.account.address, { rpc: appRpc }));
    expect(pool.nav.answer! > 0n && pool.nav.answer !== null && (pool.nav as { updatedAt: number }).updatedAt > pool.peggedAt).to.equal(true, "a newer record waits to be applied");
    const repegged = await send(keeper, calls.repeg());
    const converted = v4Fill(repegged, deployment, provider.account.address).converted!;
    expect(converted.epoch).to.equal(1n);
    expect(converted.navAnswer).to.equal(101n * 100_000_000n);
    account = (await readV4Pool(deployment, provider.account.address, { rpc: appRpc })).account!;
    expect(account.waiting).to.equal(null);
    expect(account.claimableLpMicros).to.equal(converted.lpMicros, "the only depositor of the epoch claims all it minted");

    // The claim pays the LP tokens out of the hook to the wallet.
    const claimed = v4Fill(await send(provider, calls.claimShares(provider.account.address)), deployment, provider.account.address);
    expect(claimed.claimedLpMicros).to.equal(converted.lpMicros);
    // The pool's trades as lib/xstocks/lp-markout.ts counts them for its providers. The re-peg's own
    // swap, which moves the empty pool, is not one; a purchase's result at the NAV is what the buyer
    // paid less the USTX they received at that NAV, read here from their balances.
    const logsOf = async (hash: string) => (await publicClient.getTransactionReceipt({ hash: hash as Hex })).logs.map(log => ({
      address: log.address.toLowerCase(), topics: log.topics.map(topic => topic.toLowerCase()), data: log.data.toLowerCase(),
      block: Number(log.blockNumber), logIndex: log.logIndex, hash: log.transactionHash.toLowerCase(),
    }));
    const none = { trades: 0, volumeMicros: 0n, resultMicros: 0n, arbitrages: 0, arbitrageResultMicros: 0n };
    const start: LpMarkout = { fromBlock: 0, fromTime: 0, toBlock: 0, toTime: 0, navMicros: 101n * USD, navRecords: 0, repegs: 0, constantProduct: none, v4: none };
    const afterRepeg = applyEvents(start, await logsOf(repegged.hash), deployment);
    expect([afterRepeg.repegs, afterRepeg.v4.trades]).to.deep.equal([1, 0]);
    // The app's own purchase on the pool: the router's quote, an approval to the router, the swap
    // with the quote less 1%, and the fill read back from the router's event, exactly as quoted.
    const swaps = v4SwapCalls(deployment);
    const quoted = await readV4Quote(deployment, "buy", 10n * USD, provider.account.address, { rpc: appRpc });
    expect(quoted.amountOut !== null && quoted.amountOut > 0n && quoted.feePips !== null, quoted.reason ?? "quoted").to.equal(true);
    expect(quoted.allowanceMicros).to.equal(0n);
    await send(provider, swaps.approveDollars(10n * USD));
    const [dollarsBefore, sharesBefore] = [await dollar.read.balanceOf([provider.account.address]), await fund.read.balanceOf([provider.account.address])];
    const bought = await send(provider, swaps.swap("buy", 10n * USD, withSlippage(quoted.amountOut!), await deadline()));
    const paid = dollarsBefore - await dollar.read.balanceOf([provider.account.address]);
    const received = await fund.read.balanceOf([provider.account.address]) - sharesBefore;
    expect(v4SwapFill(bought, deployment, provider.account.address)).to.deep.equal({ side: "buy", dollarsMicros: paid, sharesMicros: quoted.amountOut });
    expect(received).to.equal(quoted.amountOut);
    // And a sale of a tenth of it back, the other direction through the same calls.
    await send(provider, swaps.approveShares(received / 10n));
    const sale = await readV4Quote(deployment, "sell", received / 10n, provider.account.address, { rpc: appRpc });
    const sold = await send(provider, swaps.swap("sell", received / 10n, withSlippage(sale.amountOut!), await deadline()));
    expect(v4SwapFill(sold, deployment, provider.account.address)).to.deep.equal({ side: "sell", sharesMicros: received / 10n, dollarsMicros: sale.amountOut });
    await send(provider, swaps.approveShares(0n));
    const traded = applyEvents(afterRepeg, await logsOf(bought.hash), deployment);
    expect(traded.v4).to.deep.equal({ trades: 1, volumeMicros: paid, resultMicros: paid - received * 101n, arbitrages: 0, arbitrageResultMicros: 0n });
    expect(traded.v4.resultMicros > 0n, "a trade at the NAV leaves its fee with the providers").to.equal(true);

    const { pool: after, account: holder } = await readV4Pool(deployment, provider.account.address, { rpc: appRpc });
    expect(holder!.lpMicros).to.equal(converted.lpMicros);

    // Withdrawing half pays at least the app's minimum, within a few micros of its estimate.
    const half = holder!.lpMicros / 2n;
    const estimate = v4WithdrawEstimate(half, after)!;
    const minima = { sharesMicros: withSlippage(estimate.sharesMicros), dollarsMicros: withSlippage(estimate.dollarsMicros) };
    const out = v4Fill(await send(provider, calls.withdraw(half, minima, await deadline())), deployment, provider.account.address).withdrawn!;
    expect(out.lpMicros).to.equal(half);
    for (const side of ["sharesMicros", "dollarsMicros"] as const) {
      expect(out[side] >= minima[side] && out[side] <= estimate[side] && estimate[side] - out[side] <= 4n, `${side}: ${out[side]} for ${estimate[side]}`).to.equal(true);
    }

    // An hour later the record is stale: the app says why swaps stopped, and withdrawals still work.
    await time.increase(3_601);
    const stale = await readV4Pool(deployment, provider.account.address, { rpc: appRpc });
    expect(stale.pool.nav.answer).to.equal(null);
    expect((stale.pool.nav as { reason: string }).reason).to.match(/over an hour old/);
    expect(stale.pool.feePips).to.equal(null);
    const rest = stale.account!.lpMicros;
    const last = v4WithdrawEstimate(rest, stale.pool)!;
    const all = v4Fill(await send(provider, calls.withdraw(rest, { sharesMicros: withSlippage(last.sharesMicros), dollarsMicros: withSlippage(last.dollarsMicros) }, await deadline())), deployment, provider.account.address).withdrawn!;
    expect(all.lpMicros).to.equal(rest);
    expect((await readV4Pool(deployment, provider.account.address, { rpc: appRpc })).account!.lpMicros).to.equal(0n);
    // A swap now reverts inside the hook; the pool manager wraps it, and the app unwraps it.
    const router = await hre.viem.getContractAt("GanymedeV4Router", deployed.router.address);
    const key = await hook.read.poolKey();
    await dollar.write.approve([router.address, maxUint256], { account: provider.account });
    const swap = await router.write.swapExactInput([key, !assetIsCurrency0, 10n * USD, 0n, BigInt(await deadline())], { account: provider.account }).catch(error => error);
    expect(v4ErrorMessage(swap)).to.match(/over an hour old/);
  });

  it("pins the pool only once it is recorded and seeded, with the app's own tokens in the pool's order", () => {
    const record = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "xlayer-testnet.json"), "utf8"));
    const hook = record.contracts.GanymedeRwaLiquidityHook;
    // deploy:v4 records the contracts before it seeds the pool, and prints the pin once it has.
    if (!hook?.seedTransaction) {
      expect(V4_POOL_DEPLOYMENT).to.equal(null);
      return;
    }
    expect(V4_POOL_DEPLOYMENT).to.not.equal(null);
    expect(V4_POOL_DEPLOYMENT!.hook).to.equal(hook.address.toLowerCase());
    expect(V4_POOL_DEPLOYMENT!.poolManager).to.equal(record.contracts.UniswapV4PoolManager.address.toLowerCase());
    expect(V4_POOL_DEPLOYMENT!.router).to.equal(record.contracts.GanymedeV4Router.address.toLowerCase());
    expect(V4_POOL_DEPLOYMENT!.poolId).to.equal(hook.poolId.toLowerCase());
    expect(V4_POOL_DEPLOYMENT!.stateSlot).to.equal(poolStateSlot(hook.poolId));
    expect(isPinnedToFund(V4_POOL_DEPLOYMENT!)).to.equal(true);
    // The lower address is currency0; a wrong flag would swap every USTX and dUSD amount the app reads and sends.
    expect(V4_POOL_DEPLOYMENT!.assetIsCurrency0).to.equal(BigInt(V4_POOL_DEPLOYMENT!.asset) < BigInt(V4_POOL_DEPLOYMENT!.dollar));
  });
});
