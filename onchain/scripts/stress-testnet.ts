/**
 * A load test of USTX on X Layer Testnet with team test wallets: each wallet claims demo dollars and
 * runs every wallet flow the app offers (invest at the fund, buy and sell on the constant-product
 * pool and through the Uniswap v4 router, add and remove pool liquidity, deposit into the v4 pool and
 * cancel or later withdraw, post USTX as collateral,
 * borrow, repay and withdraw, lend and withdraw), then redeems all its USTX at the fund, so the
 * fund's investor count returns to where it was. It also checks that wrong orders revert with the
 * contracts' own errors, without sending them.
 *
 * These wallets are the team's. Their trades show in the market activity and the pools' results
 * for providers like any other; docs/LOAD_TEST.md lists them, and they are never counted as users.
 *
 * The keys are generated once into onchain/.stress/keys.json (git-ignored, never printed). The
 * administrator wallet sends each a little testnet OKB for gas, and the last step sends what is
 * left back. Requests to the public RPC are paced, and no transaction is sent in the first 45
 * seconds after each five-minute mark, when the NAV record is written.
 *
 * Run: npm run stress:testnet   (STRESS_WALLETS=30, STRESS_CONCURRENCY=4, STRESS_REPORT=path)
 *      STRESS_SWEEP_ONLY=1 only returns the wallets' OKB to the administrator.
 */
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, encodeFunctionData, formatEther, http,
  maxUint256, parseEther, type Abi, type Address, type Hash, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadDeployment, railFor } from "./_deployment";

const ONE = 1_000_000n;
const GAS_FUND = parseEther("0.0004");
const KEYS_FILE = path.join(__dirname, "..", ".stress", "keys.json");

type Step = { wallet: number; address: Address; step: string; hash?: Hash; status: "success" | "reverted" | "failed" | "expected-revert" | "unexpected"; gasUsed?: string; ms: number; error?: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const rand = (seed: number) => () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
const usd = (micros: bigint) => `$${(Number(micros) / 1e6).toFixed(2)}`;

/** Holds off the first 45 seconds after each five-minute mark, while the NAV record is written. */
async function outsideNavWindow() {
  for (;;) {
    const intoMark = Math.floor(Date.now() / 1000) % 300;
    if (intoMark >= 45) return;
    await sleep((45 - intoMark) * 1000);
  }
}

function errorName(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(item => item instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    return error.shortMessage.replace(/https?:\/\/\S+/g, "[rpc]");
  }
  return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 200);
}

function loadKeys(count: number): Hex[] {
  const existing: Hex[] = fs.existsSync(KEYS_FILE) ? JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) : [];
  if (existing.length >= count) return existing.slice(0, count);
  const keys = [...existing, ...Array.from({ length: count - existing.length }, () => generatePrivateKey())];
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

async function main() {
  const rail = railFor(hre.network.name);
  if (rail.key !== "xlayer-testnet") throw new Error("The load test runs on X Layer Testnet only.");
  const { contracts, admin: recorded } = loadDeployment(rail);
  const address = (name: keyof typeof contracts) => {
    const record = contracts[name];
    if (!record) throw new Error(`${name} is not recorded.`);
    return record.address as Address;
  };
  const abi = async (name: string) => (await hre.artifacts.readArtifact(name)).abi as Abi;
  const [fundAbi, dollarAbi, poolAbi, routerAbi, hookAbi, lendingAbi] = await Promise.all(
    ["GanymedeBasketFund", "GanymedeDemoDollar", "GanymedeUstxPool", "GanymedeV4Router", "GanymedeRwaLiquidityHook", "GanymedeLendingMarket"].map(abi));
  const C = {
    fund: { address: address("GanymedeBasketFund"), abi: fundAbi },
    dollar: { address: address("GanymedeDemoDollar"), abi: dollarAbi },
    pool: { address: address("GanymedeUstxPool"), abi: poolAbi },
    router: { address: address("GanymedeV4Router"), abi: routerAbi },
    hook: { address: address("GanymedeRwaLiquidityHook"), abi: hookAbi },
    lending: { address: address("GanymedeLendingMarket"), abi: lendingAbi },
  };

  const chain = { id: rail.chainId, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [process.env.XLAYER_RPC_URL || rail.rpcUrl] } } } as const;
  const transport = http(undefined, { retryCount: 4, retryDelay: 1_500, timeout: 30_000 });
  const reader = createPublicClient({ chain, transport, pollingInterval: 1_500 });
  // A node of the load-balanced RPC can lag a receipt it just gave: a read at that block retries
  // until the node has it.
  async function read<T>(contract: { address: Address; abi: Abi }, functionName: string, args: unknown[] = [], blockNumber?: bigint): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await reader.readContract({ ...contract, functionName, args, ...(blockNumber ? { blockNumber } : {}) } as never) as T;
      } catch (error) {
        if (!blockNumber || attempt >= 10 || error instanceof ContractFunctionRevertedError || (error instanceof BaseError && error.walk(item => item instanceof ContractFunctionRevertedError))) throw error;
        await sleep(1_500);
      }
    }
  }

  const [admin] = await hre.viem.getWalletClients();
  if (admin.account.address.toLowerCase() !== recorded.toLowerCase()) throw new Error(`ADMIN_PRIVATE_KEY is ${admin.account.address}, but the recorded administrator is ${recorded}.`);
  const count = Number(process.env.STRESS_WALLETS ?? "30");
  const concurrency = Number(process.env.STRESS_CONCURRENCY ?? "4");
  if (!(count >= 1 && count <= 100) || !(concurrency >= 1 && concurrency <= 8)) throw new Error("STRESS_WALLETS must be 1–100 and STRESS_CONCURRENCY 1–8.");
  const accounts = loadKeys(count).map(key => privateKeyToAccount(key));
  const steps: Step[] = [];
  const started = new Date();

  async function sweep() {
    const gasPrice = await reader.getGasPrice();
    let returned = 0n;
    for (const account of accounts) {
      const wallet = createWalletClient({ account, chain, transport });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await sleep(attempt * 3_000);
          const balance = await reader.getBalance({ address: account.address, blockTag: "pending" });
          const fee = 21_000n * gasPrice * 3n;
          if (balance <= fee * 2n) break;
          const hash = await wallet.sendTransaction({ to: admin.account.address, value: balance - fee, gas: 21_000n, gasPrice: gasPrice * 2n });
          await reader.waitForTransactionReceipt({ hash });
          returned += balance - fee;
          break;
        } catch (error) {
          if (attempt === 3) console.log(`  could not return the OKB of ${account.address}: ${errorName(error)}`);
        }
      }
    }
    console.log(`Returned ${formatEther(returned)} OKB to the administrator.`);
  }
  if (process.env.STRESS_SWEEP_ONLY) return sweep();

  const [nav, navAt] = await read<[bigint, bigint]>(C.fund, "currentNav");
  const navAge = Math.floor(Date.now() / 1000) - Number(navAt);
  if (navAge > 40 * 60) throw new Error(`The NAV is ${Math.round(navAge / 60)} minutes old; the fund refuses one over an hour. Wait for the next record.`);
  const before = {
    investorCount: (await read<bigint>(C.fund, "investorCount")).toString(),
    totalSupply: (await read<bigint>(C.fund, "totalSupply")).toString(),
    poolReserves: (await read<[bigint, bigint]>(C.pool, "getReserves")).map(String),
    lendingCash: (await read<bigint>(C.lending, "cash")).toString(),
  };
  console.log(`${count} wallets, ${concurrency} at a time · NAV ${usd(nav)} (${navAge} s old) · investors ${before.investorCount}`);

  // Gas: the administrator tops up each wallet to GAS_FUND.
  let adminNonce = await reader.getTransactionCount({ address: admin.account.address, blockTag: "pending" });
  let funded = 0n;
  for (const account of accounts) {
    const balance = await reader.getBalance({ address: account.address });
    if (balance >= GAS_FUND / 2n) continue;
    await outsideNavWindow();
    const hash = await admin.sendTransaction({ to: account.address, value: GAS_FUND - balance, nonce: adminNonce++, gas: 21_000n });
    await reader.waitForTransactionReceipt({ hash });
    funded += GAS_FUND - balance;
  }
  console.log(`Sent ${formatEther(funded)} OKB for gas.\n`);

  const key = await read<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>(C.hook, "poolKey");
  const assetIsCurrency0 = key.currency0.toLowerCase() === C.fund.address.toLowerCase();

  async function runWallet(index: number) {
    const account = accounts[index];
    const wallet = createWalletClient({ account, chain, transport });
    const random = rand(index + 1);
    let nonce = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
    let lastBlock = 0n;
    const record = (step: Omit<Step, "wallet" | "address">) => { steps.push({ wallet: index, address: account.address, ...step }); };

    async function send(step: string, contract: { address: Address; abi: Abi }, functionName: string, args: unknown[], gas: bigint) {
      await outsideNavWindow();
      const t0 = Date.now();
      let hash: Hash | undefined;
      try {
        hash = await wallet.sendTransaction({ to: contract.address, data: encodeFunctionData({ abi: contract.abi, functionName, args } as never), nonce, gas });
        nonce += 1;
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 120_000 });
        lastBlock = receipt.blockNumber;
        record({ step, hash, status: receipt.status === "success" ? "success" : "reverted", gasUsed: receipt.gasUsed.toString(), ms: Date.now() - t0 });
        if (receipt.status !== "success") throw new Error(`${step} reverted`);
        return receipt;
      } catch (error) {
        if (!steps.some(item => item.hash === hash && hash)) record({ step, hash, status: "failed", ms: Date.now() - t0, error: errorName(error) });
        throw error;
      }
    }
    /** A wrong order, simulated only: it must revert with `expected`. */
    async function refuses(step: string, contract: { address: Address; abi: Abi }, functionName: string, args: unknown[], expected: string) {
      const t0 = Date.now();
      try {
        await reader.simulateContract({ account, ...contract, functionName, args } as never);
        record({ step, status: "unexpected", ms: Date.now() - t0, error: `did not revert; expected ${expected}` });
      } catch (error) {
        const name = errorName(error);
        record({ step, status: name === expected ? "expected-revert" : "unexpected", ms: Date.now() - t0, error: name });
      }
    }
    const at = () => (lastBlock ? lastBlock : undefined);
    const shares = () => read<bigint>(C.fund, "balanceOf", [account.address], at());

    try {
      // Demo dollars: a claim, unless an earlier run's are still there (claims are once a day).
      if ((await read<bigint>(C.dollar, "balanceOf", [account.address])) < 1_000n * ONE) {
        const claim = await send("claim dUSD", C.dollar, "claim", [], 150_000n);
        if ((await read<bigint>(C.dollar, "balanceOf", [account.address], claim.blockNumber)) < 1_000n * ONE) throw new Error("claim left under $1,000");
      }
      for (const spender of [C.fund.address, C.pool.address, C.router.address, C.lending.address, C.hook.address]) {
        await send(`approve dUSD → ${spender.slice(0, 8)}`, C.dollar, "approve", [spender, maxUint256], 80_000n);
      }
      for (const spender of [C.pool.address, C.router.address, C.lending.address, C.hook.address]) {
        await send(`approve USTX → ${spender.slice(0, 8)}`, C.fund, "approve", [spender, maxUint256], 80_000n);
      }

      await refuses("invest under the minimum", C.fund, "invest", [5n * ONE, 0n], "BelowMinimum");
      const investDollars = BigInt(Math.round(40 + random() * 160)) * ONE;
      const [navNow] = await read<[bigint, bigint]>(C.fund, "currentNav", [], at());
      await send(`invest ${usd(investDollars)} at the fund`, C.fund, "invest", [investDollars, investDollars * ONE / navNow * 99n / 100n], 200_000n);

      const poolBuy = BigInt(Math.round(10 + random() * 40)) * ONE;
      const poolQuote = await read<bigint>(C.pool, "quoteBuy", [poolBuy], at());
      await refuses("pool buy past its limit", C.pool, "buy", [poolBuy, poolQuote * 2n, deadline()], "SlippageExceeded");
      await send(`pool buy ${usd(poolBuy)}`, C.pool, "buy", [poolBuy, poolQuote * 97n / 100n, deadline()], 200_000n);
      const poolSell = poolQuote / 2n;
      await send("pool sell half", C.pool, "sell", [poolSell, (await read<bigint>(C.pool, "quoteSell", [poolSell], at())) * 97n / 100n, deadline()], 200_000n);

      const v4Buy = BigInt(Math.round(10 + random() * 40)) * ONE;
      const buyZeroForOne = !assetIsCurrency0;
      const v4Quote = (await reader.simulateContract({ account, ...C.router, functionName: "quoteExactInput", args: [key, buyZeroForOne, v4Buy] } as never)).result as bigint;
      await send(`v4 buy ${usd(v4Buy)}`, C.router, "swapExactInput", [key, buyZeroForOne, v4Buy, v4Quote * 97n / 100n, deadline()], 900_000n);
      const v4Sell = v4Quote / 2n;
      const v4SellQuote = (await reader.simulateContract({ account, ...C.router, functionName: "quoteExactInput", args: [key, !buyZeroForOne, v4Sell] } as never)).result as bigint;
      await send("v4 sell half", C.router, "swapExactInput", [key, !buyZeroForOne, v4Sell, v4SellQuote * 97n / 100n, deadline()], 900_000n);

      // Liquidity in the constant-product pool, added at its ratio and taken out again.
      const [reserveShares, reserveDollars] = await read<[bigint, bigint]>(C.pool, "getReserves", [], at());
      const lpShares = (await shares()) / 5n;
      const lpDollars = lpShares * reserveDollars / reserveShares;
      await send("add pool liquidity", C.pool, "addLiquidity", [lpShares, lpDollars * 101n / 100n, lpShares * 95n / 100n, lpDollars * 95n / 100n, deadline()], 250_000n);
      const lpTokens = await read<bigint>(C.pool, "balanceOf", [account.address], at());
      await send("remove pool liquidity", C.pool, "removeLiquidity", [lpTokens, 0n, 0n, deadline()], 250_000n);

      // Liquidity in the Uniswap v4 pool: a deposit waits for the next NAV record. Most wallets cancel
      // it at once; every fourth keeps it, so a record turns it into LP tokens it withdraws at the end.
      const v4Ustx = (await shares()) / 10n;
      const keepV4 = index % 4 === 0;
      await send("v4 deposit", C.hook, "deposit", assetIsCurrency0 ? [v4Ustx, maxUint256, deadline()] : [maxUint256, v4Ustx, deadline()], 900_000n);
      if (!keepV4) await send("v4 cancel deposit", C.hook, "cancelDeposit", [], 600_000n);

      // A loan against USTX: post half of it, borrow a little, repay in full and take it back.
      const collateral = (await shares()) / 2n;
      await send("post USTX collateral", C.lending, "supplyCollateral", [collateral], 200_000n);
      const borrowAmount = BigInt(10 + Math.floor(random() * 10)) * ONE;
      await refuses("borrow past the limit", C.lending, "borrow", [collateral * navNow / ONE], "InsufficientCollateral");
      await send(`borrow ${usd(borrowAmount)}`, C.lending, "borrow", [borrowAmount], 250_000n);
      await send("repay in full", C.lending, "repay", [maxUint256], 200_000n);
      await send("withdraw collateral", C.lending, "withdrawCollateral", [collateral], 200_000n);
      if (index % 3 === 0) {
        await send("lend $20", C.lending, "supply", [20n * ONE], 200_000n);
        await send("withdraw lending", C.lending, "withdraw", [maxUint256], 200_000n);
      }

      // The kept v4 deposit: withdrawn as LP tokens if a record has converted it, otherwise cancelled.
      if (keepV4) {
        const claimable = await read<bigint>(C.hook, "claimableShares", [account.address], at());
        const lp = (await read<bigint>(C.hook, "balanceOf", [account.address], at())) + claimable;
        if (lp > 0n) await send("v4 withdraw liquidity", C.hook, "withdraw", [lp, 0n, 0n, deadline()], 900_000n);
        else await send("v4 cancel deposit", C.hook, "cancelDeposit", [], 600_000n);
      }

      // Everything back at the fund: the investor count returns to where it was.
      const left = await shares();
      const [navEnd] = await read<[bigint, bigint]>(C.fund, "currentNav", [], at());
      await send("redeem all USTX", C.fund, "redeem", [left, left * navEnd / ONE * 99n / 100n], 200_000n);
      const remaining = await shares();
      if (remaining !== 0n) record({ step: "holds no USTX at the end", status: "unexpected", ms: 0, error: `${remaining} micros left` });
    } catch (error) {
      console.log(`  wallet ${index} stopped: ${errorName(error)}`);
    }
    const sent = steps.filter(step => step.wallet === index && step.hash).length;
    console.log(`  wallet ${String(index).padStart(2)} ${account.address} · ${sent} transactions`);
  }

  // A pool of workers, each taking the next wallet.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) await runWallet(next++);
  }));

  await sweep();
  const after = {
    investorCount: (await read<bigint>(C.fund, "investorCount")).toString(),
    totalSupply: (await read<bigint>(C.fund, "totalSupply")).toString(),
    poolReserves: (await read<[bigint, bigint]>(C.pool, "getReserves")).map(String),
    lendingCash: (await read<bigint>(C.lending, "cash")).toString(),
  };
  const byStatus = steps.reduce<Record<string, number>>((all, step) => ({ ...all, [step.status]: (all[step.status] ?? 0) + 1 }), {});
  const latencies = steps.filter(step => step.hash && step.status === "success").map(step => step.ms).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  const report = {
    started: started.toISOString(), finished: new Date().toISOString(), wallets: accounts.map(account => account.address),
    before, after, byStatus, confirmationMs: { p50: pct(0.5), p95: pct(0.95), max: latencies.at(-1) ?? 0 },
    problems: steps.filter(step => step.status !== "success" && step.status !== "expected-revert"), steps,
  };
  const out = process.env.STRESS_REPORT || path.join(__dirname, "..", ".stress", `report-${started.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${JSON.stringify({ byStatus, confirmationMs: report.confirmationMs, investors: `${before.investorCount} → ${after.investorCount}`, problems: report.problems.length })}`);
  console.log(`Report: ${out}`);
}

main().catch(error => {
  console.error(errorName(error));
  process.exitCode = 1;
});
