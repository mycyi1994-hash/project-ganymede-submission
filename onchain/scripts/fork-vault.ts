/**
 * Runs in-kind creation and redemption against the real xStocks without touching the chain. It
 * forks X Layer mainnet into Hardhat's in-process network and, with local test accounts:
 *
 *   1. buys AAPLx, MSFTx and NVDAx on their Uniswap V3 pools with USDG, unwrapping each pool's
 *      ERC-4626 wrapper into the xStock itself (the USDG comes from a pool outside the basket);
 *   2. deploys GanymedeBasketVault with MAG3's units per share for the first creation
 *      (public/baskets/mag3/basket.json);
 *   3. creates 10 shares by delivering those units, rounded up plus the allowance;
 *   4. moves 4 shares to a second account, which redeems them for 4/10 of the holdings;
 *   5. redeems the other 6 and checks nothing but rounding allowances is left.
 *
 * No key is used and nothing is broadcast. Run: npm run fork:vault
 */
import hre from "hardhat";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatUnits, maxUint256, parseAbi, type Address } from "viem";

const MAINNET_RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";
const USDG = "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8" as Address;
/** The METAx pool, outside MAG3; on the fork its USDG pays for the purchases. */
const USDG_SOURCE = "0xfad9e3c7550768fd4f34bc9cefd365cc193c0fb0" as Address;
/** The same pools and wrappers the second price source reads (lib/xstocks/pool-prices.ts). */
const POOLS: Record<string, { pool: Address; wrapper: Address }> = {
  AAPLx: { pool: "0xc44bd9c8589026d28d1632d7b86b2efb6cdc8fd2", wrapper: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f" },
  MSFTx: { pool: "0x66187278490a70a8ac26a6e159eb045f82dbfb57", wrapper: "0x166fbe68274b6a47e025f4ba17388c539f1fa1d0" },
  NVDAx: { pool: "0x2a2b11730c2b6d99a58034a869dd810d7300a7b2", wrapper: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5" },
};
const SPEND = 400_000_000n; // $400 of USDG for each xStock
const SHARES = 10_000_000n; // 10 shares (6 decimals)
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address, uint256) returns (bool)", "function approve(address, uint256) returns (bool)"]);

type Constituent = { symbol: string; address: Address; unitsWad: string };
const tokens = (amount: bigint) => Number(formatUnits(amount, 18)).toFixed(6);

async function main() {
  if (hre.network.name !== "hardhat") throw new Error("This runs on a local fork only: npm run fork:vault");
  const basket = JSON.parse(readFileSync(path.join(__dirname, "../../public/baskets/mag3/basket.json"), "utf8")) as { constituents: Constituent[] };
  await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: MAINNET_RPC } }] });
  const publicClient = await hre.viem.getPublicClient();
  const block = await publicClient.getBlock();
  console.log(`forked X Layer mainnet at block ${block.number} (${new Date(Number(block.timestamp) * 1000).toISOString()}), in memory only\n`);
  const balance = (token: Address, owner: Address) => publicClient.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] });
  const [creator, holder] = await hre.viem.getWalletClients();

  // 1. Buy each xStock on its pool and unwrap it.
  const buyer = await hre.viem.deployContract("ForkPoolBuyer", []);
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [USDG_SOURCE] });
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [USDG_SOURCE, "0x56bc75e2d63100000"] });
  const source = await hre.viem.getWalletClient(USDG_SOURCE);
  await source.writeContract({ address: USDG, abi: erc20, functionName: "transfer", args: [buyer.address, SPEND * BigInt(basket.constituents.length)] });
  console.log("1. bought on the X Layer pools and unwrapped");
  for (const row of basket.constituents) {
    const { pool, wrapper } = POOLS[row.symbol];
    const before = await balance(row.address, creator.account.address);
    await buyer.write.buy([pool, USDG, wrapper, SPEND, creator.account.address]);
    const bought = (await balance(row.address, creator.account.address)) - before;
    if (bought === 0n) throw new Error(`No ${row.symbol} came out of the wrapper.`);
    console.log(`   ${row.symbol.padEnd(6)} ${tokens(bought)} for $${formatUnits(SPEND, 6)} USDG in pool ${pool}`);
  }

  // 2. The vault, with MAG3's units per share for the first creation.
  const addresses = basket.constituents.map((row) => row.address);
  const units = basket.constituents.map((row) => BigInt(row.unitsWad));
  const vault = await hre.viem.deployContract("GanymedeBasketVault", ["Ganymede MAG3 in kind (fork)", "MAG3", addresses, units]);
  console.log("\n2. vault deployed on the local fork with MAG3's units per share for the first creation");

  const report = async (label: string) => {
    const supply = await vault.read.totalSupply();
    const perShare = await vault.read.holdingsPerShare();
    console.log(`   ${label}: ${formatUnits(supply, 6)} shares outstanding`);
    for (const [index, row] of basket.constituents.entries()) {
      const held = await balance(row.address, vault.address);
      console.log(`     ${row.symbol.padEnd(6)} held ${tokens(held)}, per share ${tokens(perShare[index])} (MAG3 units ${tokens(units[index])})`);
      // Every outstanding share is backed by at least MAG3's units: nothing has left the vault but redemptions.
      if (supply > 0n && held * 1_000_000n < units[index] * supply) throw new Error(`${row.symbol} holds less than MAG3's units for every share.`);
    }
  };

  // 3. Create 10 shares by delivering MAG3's units, rounded up, plus the allowance.
  for (const token of addresses) await creator.writeContract({ address: token, abi: erc20, functionName: "approve", args: [vault.address, maxUint256] });
  const [, createIn] = await vault.read.amountsFor([SHARES]);
  const before = await Promise.all(addresses.map((token) => balance(token, creator.account.address)));
  await vault.write.create([SHARES, createIn]);
  const after = await Promise.all(addresses.map((token) => balance(token, creator.account.address)));
  console.log(`\n3. created ${formatUnits(SHARES, 6)} shares by delivering MAG3's units × shares, rounded up, plus ${await vault.read.ROUNDING_ALLOWANCE()} base units:`);
  for (const [index, row] of basket.constituents.entries()) {
    const paid = before[index] - after[index];
    // A multiplier token can debit the sender a base unit more or less than the amount sent.
    if (paid + 1n < createIn[index] || paid > createIn[index] + 1n) throw new Error(`Creation took ${paid} ${row.symbol}, not ${createIn[index]}.`);
    console.log(`     ${row.symbol.padEnd(6)} ${tokens(paid)} (${paid} base units)`);
  }
  await report("after creation");

  // 4. A second account receives 4 shares and redeems them for its share of the holdings.
  const moved = 4_000_000n;
  await vault.write.transfer([holder.account.address, moved]);
  const [, , redeemOut] = await vault.read.amountsFor([moved]);
  await vault.write.redeem([moved], { account: holder.account });
  console.log(`\n4. a second account received ${formatUnits(moved, 6)} shares and redeemed them for 4/10 of the holdings:`);
  for (const [index, row] of basket.constituents.entries()) {
    const received = await balance(row.address, holder.account.address);
    // The token's own rounding can deliver a base unit or two less than the vault sent.
    if (received > redeemOut[index] || redeemOut[index] - received > 2n) throw new Error(`Redemption paid ${received} ${row.symbol}, not ${redeemOut[index]}.`);
    if (received * 1_000_000n + 10n * 1_000_000n < units[index] * moved) throw new Error(`Redemption paid less than MAG3's units for ${row.symbol}.`);
    console.log(`     ${row.symbol.padEnd(6)} ${tokens(received)} (${received} base units; the vault sent ${redeemOut[index]})`);
  }
  await report("after that redemption");

  // 5. The creator redeems the rest.
  await vault.write.redeem([SHARES - moved]);
  console.log(`\n5. the creator redeemed the other ${formatUnits(SHARES - moved, 6)} shares`);
  await report("at the end");
  for (const row of basket.constituents) {
    const dust = await balance(row.address, vault.address);
    if (dust > 30n) throw new Error(`${row.symbol}: ${dust} base units left, more than the rounding allowances.`);
    console.log(`     ${row.symbol.padEnd(6)} ${dust} base units of rounding allowance stay in the vault`);
  }
  console.log("\nevery step matched: shares were created only against the xStocks and redeemed for their share of them.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
