/**
 * A load test of the USTX lending market on X Layer Testnet with the team's test wallets: each wallet
 * invests a little at the fund for collateral, then runs STRESS_CYCLES rounds of the market's every
 * flow (post collateral, borrow, borrow more, take back part of the collateral while borrowing,
 * repay half, repay in full, take back the rest, lend, withdraw half, withdraw the rest), and finally
 * redeems its USTX at the fund, so it ends holding no USTX, loan, collateral or lending. The first
 * round also checks, without sending them, that wrong orders revert with the market's own errors.
 *
 * Like scripts/stress-testnet.ts it uses the keys in onchain/.stress/keys.json (git-ignored, never
 * printed); the wallets are the team's and are never counted as users (lib/xstocks/team-wallets.ts).
 * The administrator sends a wallet a little testnet OKB for gas just before it starts and the wallet
 * sends what is left back when it finishes. No transaction is sent in the first 45 seconds after
 * each five-minute mark, when the NAV record is written.
 *
 * A wallet without demo dollars or approvals first claims and approves. Keys missing from the file
 * are generated and added to it. The administrator's transfers are sent back to back without waiting
 * for each to confirm, and stop while its balance is under STRESS_ADMIN_RESERVE_OKB until it is
 * topped up; STRESS_FROM skips the wallets an interrupted run finished.
 *
 * Run: npm run stress:lending   (STRESS_WALLETS=100, STRESS_CONCURRENCY=10, STRESS_CYCLES=5, STRESS_GAS_OKB=0.0004,
 *      STRESS_EXTRA_ROUND_EVERY=0, STRESS_FROM=0, STRESS_ADMIN_RESERVE_OKB=0.005, STRESS_REPORT=path). Each round
 *      is ten transactions a wallet, about 0.000012 testnet OKB of gas; every STRESS_EXTRA_ROUND_EVERY-th wallet
 *      runs one more round.
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
const GAS_FUND = parseEther(process.env.STRESS_GAS_OKB ?? "0.0004");
const ADMIN_RESERVE = parseEther(process.env.STRESS_ADMIN_RESERVE_OKB ?? "0.005");
const KEYS_FILE = path.join(__dirname, "..", ".stress", "keys.json");

type Step = { wallet: number; address: Address; step: string; hash?: Hash; status: "success" | "reverted" | "failed" | "expected-revert" | "unexpected"; gasUsed?: string; ms: number; error?: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const rand = (seed: number) => () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
const usd = (micros: bigint) => `$${(Number(micros) / 1e6).toFixed(2)}`;

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
  const [fundAbi, dollarAbi, lendingAbi] = await Promise.all(["GanymedeBasketFund", "GanymedeDemoDollar", "GanymedeLendingMarket"].map(abi));
  const C = {
    fund: { address: address("GanymedeBasketFund"), abi: fundAbi },
    dollar: { address: address("GanymedeDemoDollar"), abi: dollarAbi },
    lending: { address: address("GanymedeLendingMarket"), abi: lendingAbi },
  };

  const chain = { id: rail.chainId, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [process.env.XLAYER_RPC_URL || rail.rpcUrl] } } } as const;
  const transport = http(undefined, { retryCount: 4, retryDelay: 1_500, timeout: 30_000 });
  const reader = createPublicClient({ chain, transport, pollingInterval: 1_500 });
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
  const count = Number(process.env.STRESS_WALLETS ?? "100");
  const concurrency = Number(process.env.STRESS_CONCURRENCY ?? "10");
  const cycles = Number(process.env.STRESS_CYCLES ?? "5");
  const extraEvery = Number(process.env.STRESS_EXTRA_ROUND_EVERY ?? "0");
  const from = Number(process.env.STRESS_FROM ?? "0");
  if (!(count >= 1 && count <= 3_000) || !(concurrency >= 1 && concurrency <= 32) || !(cycles >= 1 && cycles <= 20) || !(from >= 0 && from < count)) {
    throw new Error("STRESS_WALLETS must be 1–3000, STRESS_CONCURRENCY 1–32, STRESS_CYCLES 1–20 and STRESS_FROM under STRESS_WALLETS.");
  }
  const keys: Hex[] = fs.existsSync(KEYS_FILE) ? JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) : [];
  if (keys.length < count) {
    keys.push(...Array.from({ length: count - keys.length }, () => generatePrivateKey()));
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys), { mode: 0o600 });
  }
  const accounts = keys.slice(0, count).map(key => privateKeyToAccount(key));
  const steps: Step[] = [];
  const started = new Date();

  const [nav, navAt] = await read<[bigint, bigint]>(C.fund, "currentNav");
  const navAge = Math.floor(Date.now() / 1000) - Number(navAt);
  if (navAge > 40 * 60) throw new Error(`The NAV is ${Math.round(navAge / 60)} minutes old; the market refuses one over an hour. Wait for the next record.`);
  const market = async () => ({
    investorCount: (await read<bigint>(C.fund, "investorCount")).toString(),
    cash: (await read<bigint>(C.lending, "cash")).toString(),
    totalSupplied: (await read<bigint>(C.lending, "totalSupplied")).toString(),
    totalBorrowed: (await read<bigint>(C.lending, "totalBorrowed")).toString(),
    reserves: (await read<bigint>(C.lending, "reserves")).toString(),
  });
  const before = await market();
  console.log(`wallets ${from}–${count - 1}, ${concurrency} at a time, ${cycles} rounds each${extraEvery ? ` (+1 every ${extraEvery}th)` : ""} · NAV ${usd(nav)} (${navAge} s old) · market cash ${usd(BigInt(before.cash))}`);

  // The administrator's transfers are sent one at a time with nonces counted here, without waiting
  // for each to confirm; a failed send recounts them. Every 20 transfers its balance is checked, and
  // under the reserve the transfers wait until it is topped up.
  let adminQueue: Promise<unknown> = Promise.resolve();
  let adminNonce: number | undefined;
  let adminSends = 0;
  let funded = 0n;
  let returned = 0n;
  const fundGas = async (to: Address) => {
    const balance = await reader.getBalance({ address: to });
    if (balance >= GAS_FUND / 2n) return;
    let hash: Hash | undefined;
    const job = adminQueue.then(async () => {
      if (adminSends++ % 20 === 0) {
        for (let waited = false; ; waited = true) {
          const left = await reader.getBalance({ address: admin.account.address });
          if (left >= ADMIN_RESERVE) { if (waited) console.log(`  administrator topped up: ${formatEther(left)} OKB`); break; }
          if (!waited) console.log(`  administrator has ${formatEther(left)} OKB, under the reserve; waiting for a top-up`);
          await sleep(30_000);
        }
      }
      await outsideNavWindow();
      adminNonce ??= await reader.getTransactionCount({ address: admin.account.address, blockTag: "pending" });
      try {
        hash = await admin.sendTransaction({ to, value: GAS_FUND - balance, gas: 21_000n, nonce: adminNonce });
        adminNonce += 1;
      } catch (error) {
        adminNonce = undefined;
        throw error;
      }
    });
    adminQueue = job.catch(() => undefined);
    await job;
    await reader.waitForTransactionReceipt({ hash: hash!, timeout: 120_000 });
    funded += GAS_FUND - balance;
  };

  async function runWallet(index: number) {
    const account = accounts[index];
    const wallet = createWalletClient({ account, chain, transport });
    const random = rand(1_000 + index);
    let lastBlock = 0n;
    const record = (step: Omit<Step, "wallet" | "address">) => { steps.push({ wallet: index, address: account.address, ...step }); };
    const at = () => (lastBlock ? lastBlock : undefined);

    for (let attempt = 0; ; attempt += 1) {
      try {
        await fundGas(account.address);
        break;
      } catch (error) {
        if (attempt < 3) { await sleep(3_000); continue; }
        record({ step: "gas from the administrator", status: "failed", ms: 0, error: errorName(error) });
        console.log(`  wallet ${index} skipped: no gas (${errorName(error)})`);
        return;
      }
    }
    let nonce = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });

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
    async function refuses(step: string, functionName: string, args: unknown[], expected: string) {
      const t0 = Date.now();
      // As with reads, a node that has not caught up with the last block fails the call; it is retried.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await reader.simulateContract({ account, ...C.lending, functionName, args, ...(lastBlock ? { blockNumber: lastBlock } : {}) } as never);
          record({ step, status: "unexpected", ms: Date.now() - t0, error: `did not revert; expected ${expected}` });
          return;
        } catch (error) {
          const reverted = error instanceof BaseError && error.walk(item => item instanceof ContractFunctionRevertedError);
          if (!reverted && attempt < 10) { await sleep(1_500); continue; }
          const name = errorName(error);
          record({ step, status: name === expected ? "expected-revert" : "unexpected", ms: Date.now() - t0, error: name });
          return;
        }
      }
    }
    const shares = () => read<bigint>(C.fund, "balanceOf", [account.address], at());
    const debt = () => read<bigint>(C.lending, "borrowBalanceOf", [account.address], at());

    try {
      // Approvals from an earlier run stay; only a missing one is sent.
      for (const [token, spender, label] of [[C.dollar, C.fund.address, "dUSD → fund"], [C.dollar, C.lending.address, "dUSD → market"], [C.fund, C.lending.address, "USTX → market"]] as const) {
        if ((await read<bigint>(token, "allowance", [account.address, spender])) < 1_000_000n * ONE) await send(`approve ${label}`, token, "approve", [spender, maxUint256], 80_000n);
      }
      if ((await read<bigint>(C.dollar, "balanceOf", [account.address])) < 1_000n * ONE) await send("claim dUSD", C.dollar, "claim", [], 150_000n);

      const investDollars = BigInt(Math.round(250 + random() * 150)) * ONE;
      const [navNow] = await read<[bigint, bigint]>(C.fund, "currentNav", [], at());
      await send(`invest ${usd(investDollars)} at the fund`, C.fund, "invest", [investDollars, investDollars * ONE / navNow * 99n / 100n], 200_000n);

      for (let round = 0; round < cycles + (extraEvery && index % extraEvery === 0 ? 1 : 0); round += 1) {
        const held = await shares();
        const collateral = held * BigInt(40 + Math.floor(random() * 21)) / 100n;
        if (round === 0) await refuses("borrow with no collateral", "borrow", [10n * ONE], "InsufficientCollateral");
        await send("post collateral", C.lending, "supplyCollateral", [collateral], 150_000n);

        const [, limit] = await read<[bigint, bigint, bigint]>(C.lending, "collateralValueOf", [account.address], at());
        if (round === 0) {
          await refuses("borrow under the minimum", "borrow", [5n * ONE], "BelowMinimum");
          await refuses("borrow past the limit", "borrow", [limit + ONE], "InsufficientCollateral");
        }
        const first = BigInt(Math.max(10, Math.floor(Number(limit / ONE) * (0.25 + random() * 0.15)))) * ONE;
        await send("borrow", C.lending, "borrow", [first], 200_000n);
        await send("borrow more", C.lending, "borrow", [10n * ONE], 200_000n);
        if (round === 0) await refuses("take back all collateral while borrowing", "withdrawCollateral", [maxUint256], "InsufficientCollateral");
        await send("take back part of the collateral", C.lending, "withdrawCollateral", [collateral / 5n], 150_000n);

        await send("repay half", C.lending, "repay", [(await debt()) / 2n], 150_000n);
        await send("repay in full", C.lending, "repay", [maxUint256], 150_000n);
        await send("take back the collateral", C.lending, "withdrawCollateral", [maxUint256], 150_000n);

        const lent = BigInt(20 + Math.floor(random() * 61)) * ONE;
        await send("lend", C.lending, "supply", [lent], 150_000n);
        if (round === 0) await refuses("withdraw more than lent", "withdraw", [lent * 2n], "InsufficientBalance");
        await send("withdraw half the lending", C.lending, "withdraw", [lent / 2n], 150_000n);
        await send("withdraw the rest of the lending", C.lending, "withdraw", [maxUint256], 150_000n);
      }

      const [loan, collateralLeft, lending] = await Promise.all([debt(), read<bigint>(C.lending, "collateralOf", [account.address], at()), read<bigint>(C.lending, "supplyBalanceOf", [account.address], at())]);
      if (loan || collateralLeft || lending) record({ step: "holds nothing in the market at the end", status: "unexpected", ms: 0, error: `loan ${loan}, collateral ${collateralLeft}, lending ${lending}` });
      const left = await shares();
      const [navEnd] = await read<[bigint, bigint]>(C.fund, "currentNav", [], at());
      await send("redeem all USTX", C.fund, "redeem", [left, left * navEnd / ONE * 99n / 100n], 200_000n);
      const remaining = await shares();
      if (remaining !== 0n) record({ step: "holds no USTX at the end", status: "unexpected", ms: 0, error: `${remaining} micros left` });
    } catch (error) {
      console.log(`  wallet ${index} stopped: ${errorName(error)}`);
    }

    // What is left of the gas goes back to the administrator.
    try {
      const gasPrice = await reader.getGasPrice();
      const balance = await reader.getBalance({ address: account.address, blockTag: "pending" });
      const fee = 21_000n * gasPrice * 3n;
      if (balance > fee * 2n) {
        const hash = await wallet.sendTransaction({ to: admin.account.address, value: balance - fee, nonce, gas: 21_000n, gasPrice: gasPrice * 2n });
        await reader.waitForTransactionReceipt({ hash });
        returned += balance - fee;
      }
    } catch (error) {
      console.log(`  could not return the OKB of wallet ${index}: ${errorName(error)}`);
    }
    const sent = steps.filter(step => step.wallet === index && step.hash).length;
    console.log(`  wallet ${String(index).padStart(2)} ${account.address} · ${sent} transactions · ${steps.filter(step => step.hash).length} in all`);
  }

  let next = from;
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) await runWallet(next++);
  }));

  const after = await market();
  const byStatus = steps.reduce<Record<string, number>>((all, step) => ({ ...all, [step.status]: (all[step.status] ?? 0) + 1 }), {});
  const sentSteps = steps.filter(step => step.hash);
  const byStep = sentSteps.reduce<Record<string, number>>((all, step) => {
    const name = step.step.replace(/ \$[\d.]+.*$/, "");
    return { ...all, [name]: (all[name] ?? 0) + 1 };
  }, {});
  const latencies = sentSteps.filter(step => step.status === "success").map(step => step.ms).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  const gasUsed = sentSteps.reduce((sum, step) => sum + BigInt(step.gasUsed ?? "0"), 0n);
  const report = {
    started: started.toISOString(), finished: new Date().toISOString(), wallets: accounts.map(account => account.address), cycles,
    before, after, byStatus, byStep, transactions: sentSteps.length, gasUsed: gasUsed.toString(),
    gas: { fundedOkb: formatEther(funded), returnedOkb: formatEther(returned) },
    confirmationMs: { p50: pct(0.5), p95: pct(0.95), max: latencies.at(-1) ?? 0 },
    problems: steps.filter(step => step.status !== "success" && step.status !== "expected-revert"), steps,
  };
  const out = process.env.STRESS_REPORT || path.join(__dirname, "..", ".stress", `lending-${started.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${JSON.stringify({ transactions: sentSteps.length, byStatus, byStep, confirmationMs: report.confirmationMs, gas: report.gas, investors: `${before.investorCount} → ${after.investorCount}`, problems: report.problems.length })}`);
  console.log(`Report: ${out}`);
}

main().catch(error => {
  console.error(errorName(error));
  process.exitCode = 1;
});
