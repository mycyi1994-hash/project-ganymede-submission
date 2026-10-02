/**
 * Demo trades on the Uniswap v4 USTX/dUSD pool on X Layer Testnet, from the administrator wallet:
 * a purchase of USTX with demo dollars and a sale of part of it back through GanymedeV4Router, and a
 * small deposit that becomes LP tokens at the next NAV record (a later run claims them). It gives the
 * pool's Pools panel, its results for providers (lib/xstocks/lp-markout.ts) and its activity real
 * trades to show. Each swap is quoted first and takes at least 99% of the quote.
 *
 * Demo dollars and USTX have no value; these are trades, not administrator actions.
 *
 * Run: npm run trade:v4   (TRADE_DOLLARS=25 to change the size of the purchase, in demo dollars)
 */
import hre from "hardhat";
import { maxUint256, parseEventLogs, type Address, type Hash } from "viem";
import { loadDeployment, railFor } from "./_deployment";

const ONE = 1_000_000n;

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The v4 pool runs on X Layer Testnet only.");
  const { contracts, admin: recorded } = loadDeployment(rail);
  const { GanymedeRwaLiquidityHook: hookRecord, GanymedeV4Router: routerRecord, GanymedeBasketFund: fundRecord, GanymedeDemoDollar: dollarRecord } = contracts;
  if (!hookRecord?.seedTransaction || !routerRecord || !fundRecord || !dollarRecord) throw new Error("No seeded v4 pool is recorded. Run `npm run deploy:v4` first.");
  const [wallet] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const trader = wallet.account.address;
  if (trader.toLowerCase() !== recorded.toLowerCase()) throw new Error(`ADMIN_PRIVATE_KEY is ${trader}, but the recorded administrator is ${recorded}.`);

  const hook = await hre.viem.getContractAt("GanymedeRwaLiquidityHook", hookRecord.address as Address);
  const router = await hre.viem.getContractAt("GanymedeV4Router", routerRecord.address as Address);
  const fund = await hre.viem.getContractAt("GanymedeBasketFund", fundRecord.address as Address);
  const dollar = await hre.viem.getContractAt("GanymedeDemoDollar", dollarRecord.address as Address);
  const key = await hook.read.poolKey();
  const assetIsCurrency0 = key.currency0.toLowerCase() === fund.address.toLowerCase();
  let nonce = await publicClient.getTransactionCount({ address: trader, blockTag: "pending" });
  async function send(label: string, write: (options: { nonce: number; gas: bigint }) => Promise<Hash>, gas: bigint) {
    const hash = await write({ nonce: nonce++, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label.padEnd(24)} ${hash}`);
    return receipt;
  }
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
  const tradeDollars = BigInt(Math.round(Number(process.env.TRADE_DOLLARS ?? "25") * 1e6));
  if (tradeDollars < ONE) throw new Error("TRADE_DOLLARS must be at least 1.");

  const [answer, updatedAt] = await hook.read.nav();
  console.log(`v4 pool ${hook.address} · NAV $${Number(answer) / 1e8} recorded ${Math.floor(Date.now() / 1000) - Number(updatedAt)} s ago · trader ${trader}\n`);

  // A claim of shares from a deposit an earlier run made, once its NAV record converted it.
  if ((await hook.read.claimableShares([trader])) > 0n) await send("claim LP tokens", options => hook.write.claimShares([trader], { account: wallet.account, ...options }), 200_000n);

  if ((await dollar.read.balanceOf([trader])) < tradeDollars * 2n && (await dollar.read.nextClaimAt([trader])) <= BigInt(Math.floor(Date.now() / 1000))) {
    await send("claim 10,000 dUSD", options => dollar.write.claim({ account: wallet.account, ...options }), 150_000n);
  }
  const balance = await dollar.read.balanceOf([trader]);
  if (balance < tradeDollars * 2n) {
    const next = new Date(Number(await dollar.read.nextClaimAt([trader])) * 1000).toISOString();
    throw new Error(`The trader holds $${Number(balance) / 1e6} in demo dollars, under the $${Number(tradeDollars * 2n) / 1e6} these trades use; it can claim more at ${next}.`);
  }
  if ((await dollar.read.allowance([trader, router.address])) < tradeDollars * 10n) {
    await send("approve router dUSD", options => dollar.write.approve([router.address, maxUint256], { account: wallet.account, ...options }), 80_000n);
  }
  if ((await fund.read.allowance([trader, router.address])) < tradeDollars) {
    await send("approve router USTX", options => fund.write.approve([router.address, maxUint256], { account: wallet.account, ...options }), 80_000n);
  }

  // Buy USTX with demo dollars: the dollar is currency1 when USTX is currency0.
  const buy = !assetIsCurrency0;
  const quotedShares = (await router.simulate.quoteExactInput([key, buy, tradeDollars], { account: trader })).result;
  const bought = await send(`buy $${Number(tradeDollars) / 1e6} of USTX`, options =>
    router.write.swapExactInput([key, buy, tradeDollars, quotedShares * 99n / 100n, deadline()], { account: wallet.account, ...options }), 900_000n);
  const [boughtEvent] = parseEventLogs({ abi: router.abi, logs: bought.logs, eventName: "Swapped" });
  const shares = boughtEvent.args.amountOut;
  console.log(`    ${Number(shares) / 1e6} USTX for $${Number(tradeDollars) / 1e6}: $${(Number(tradeDollars) / Number(shares)).toFixed(4)} each`);

  // Sell half of it back.
  const half = shares / 2n;
  const quotedDollars = (await router.simulate.quoteExactInput([key, !buy, half], { account: trader })).result;
  const sold = await send(`sell ${Number(half) / 1e6} USTX`, options =>
    router.write.swapExactInput([key, !buy, half, quotedDollars * 99n / 100n, deadline()], { account: wallet.account, ...options }), 900_000n);
  const [soldEvent] = parseEventLogs({ abi: router.abi, logs: sold.logs, eventName: "Swapped" });
  console.log(`    $${Number(soldEvent.args.amountOut) / 1e6} for ${Number(half) / 1e6} USTX`);

  // A small deposit of the rest with demo dollars at the holdings' ratio: LP tokens at the next record.
  const rest = shares - half;
  const [max0, max1] = assetIsCurrency0 ? [rest, tradeDollars] : [tradeDollars, rest];
  const [take0, take1] = await hook.read.previewDeposit([max0, max1]);
  const [takeShares, pairedDollars] = assetIsCurrency0 ? [take0, take1] : [take1, take0];
  if (takeShares > 0n && pairedDollars > 0n) {
    if ((await dollar.read.allowance([trader, hook.address])) < pairedDollars) {
      await send("approve hook dUSD", options => dollar.write.approve([hook.address, maxUint256], { account: wallet.account, ...options }), 80_000n);
    }
    if ((await fund.read.allowance([trader, hook.address])) < takeShares) {
      await send("approve hook USTX", options => fund.write.approve([hook.address, maxUint256], { account: wallet.account, ...options }), 80_000n);
    }
    await send(`deposit ${Number(takeShares) / 1e6} USTX + $${(Number(pairedDollars) / 1e6).toFixed(2)}`, options =>
      hook.write.deposit([take0, take1, deadline()], { account: wallet.account, ...options }), 900_000n);
  }
  console.log("\nThe deposit becomes LP tokens at the next NAV record; run again later to claim them.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
