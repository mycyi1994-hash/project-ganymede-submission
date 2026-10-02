// A browser test of the production app with a team test wallet: Playwright opens the site with the
// wallet injected as window.okxwallet, and every transaction the app asks for is signed here by a
// test key (kept in onchain/.stress/e2e-keys.json, git-ignored) and sent to X Layer Testnet.
//
// Flows (E2E_FLOW): default buys $60 at the fund, the constant-product pool and the v4 pool and
// sells everything at the fund; "lending" posts collateral, borrows, repays, withdraws, lends and
// withdraws; "pools" adds liquidity from demo dollars and withdraws it (SKIP_ADD=1 only withdraws).
// READ_ONLY=1 only visits the pages. It reports page errors, console errors and HTTP errors.
//
// Run from onchain/: ADMIN_PRIVATE_KEY=… node scripts/e2e-wallet.mjs
//   PLAYWRIGHT_MODULE, CHROMIUM_PATH, BROWSER_PROXY and BROWSER_ARGS adapt it to the machine;
//   SHOTS=dir saves a screenshot after each step.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const SITE = "https://ganymede-xlayer.gana003.workers.dev";
const SHOTS = process.env.SHOTS;
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } } };
const transport = http(undefined, { retryCount: 4, retryDelay: 1500 });
const reader = createPublicClient({ chain, transport });
const file = new URL("../.stress/e2e-keys.json", import.meta.url);
fs.mkdirSync(new URL("../.stress/", import.meta.url), { recursive: true });
const keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const index = Number(process.env.E2E_WALLET ?? 0);
while (keys.length <= index) keys.push(generatePrivateKey());
fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
const account = privateKeyToAccount(keys[index]);
const wallet = createWalletClient({ account, chain, transport });

// Gas from the administrator, if the wallet has none.
if ((await reader.getBalance({ address: account.address })) < parseEther("0.0002")) {
  const admin = createWalletClient({ account: privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY.startsWith("0x") ? process.env.ADMIN_PRIVATE_KEY : "0x" + process.env.ADMIN_PRIVATE_KEY), chain, transport });
  await reader.waitForTransactionReceipt({ hash: await admin.sendTransaction({ to: account.address, value: parseEther("0.0005"), gas: 21000n }) });
}
console.log("test wallet", account.address);

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY } } : {}),
  args: (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", error => problems.push("pageerror: " + error.message));
page.on("console", message => { if (message.type() === "error") problems.push("console: " + message.text().slice(0, 200)); });
page.on("response", async response => { if (response.status() >= 400) { let body = ""; try { body = (await response.text()).slice(0, 200); } catch {} problems.push(`HTTP ${response.status()} ${response.url().slice(0, 120)} req=${(response.request().postData() ?? "").slice(0, 300)} res=${body}`); } });
const sent = [];
await page.exposeFunction("__walletRequest", async (method, params) => {
  try {
    switch (method) {
      case "eth_requestAccounts": case "eth_accounts": return { result: [account.address] };
      case "eth_chainId": return { result: "0x7a0" };
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return { result: null };
      case "wallet_watchAsset": return { result: true };
      case "eth_sendTransaction": {
        const [tx] = params;
        const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
        sent.push(hash);
        return { result: hash };
      }
      default: return { result: await reader.request({ method, params }) };
    }
  } catch (error) { return { error: { code: error.code ?? -32603, message: error.shortMessage ?? error.message } }; }
});
await page.addInitScript(() => {
  window.okxwallet = { isOkxWallet: true, on() {}, removeListener() {}, async request({ method, params }) {
    const reply = await window.__walletRequest(method, params ?? []);
    if (reply.error) { const error = new Error(reply.error.message); error.code = reply.error.code; throw error; }
    return reply.result;
  } };
});

const step = async (name, run) => {
  const t0 = Date.now();
  try { await run(); console.log("ok  ", name, `${Date.now() - t0} ms`); }
  catch (error) { console.log("FAIL", name, error.message.split("\n")[0]); if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-fail-${name.replace(/\W+/g, "-")}.png`, fullPage: false }); throw error; }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-${name.replace(/\W+/g, "-")}.png` });
};

if (process.env.READ_ONLY) {
  await page.goto(SITE + "/products/ustx", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: "Connect OKX Wallet" }).first().click();
  await page.getByText("USTX in wallet").waitFor({ timeout: 60000 });
  for (const path of ["/pools", "/portfolio", "/products/ustx/transparency", "/"]) { await page.goto(SITE + path, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {}); await page.waitForTimeout(4000); }
  console.log("problems", JSON.stringify([...new Set(problems)], null, 1));
  await browser.close();
  process.exit(0);
}
const buyAtFund = async dollars => {
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page.locator("#wallet-amount").fill(String(dollars));
  await page.waitForFunction(() => { const r = document.querySelector('input[name="wallet-venue"][value="fund"]'); return r && !r.disabled; }, null, { timeout: 60000 });
  await page.locator('input[name="wallet-venue"][value="fund"]').check({ force: true });
  await page.getByRole("button", { name: /Review order/ }).click();
  await page.getByRole("button", { name: /Confirm in wallet/ }).click();
  await page.getByText(/Order filled|Added to your basket/).first().waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: /Place another order/ }).click();
};
const lendingStep = async (label, amount, useMax = false) => {
  const section = page.locator("#borrow");
  await section.getByRole("button", { name: label, exact: true }).click();
  if (useMax) { await page.waitForFunction(() => document.querySelector("#borrow .gmd-lending-max"), null, { timeout: 60000 }); await section.locator(".gmd-lending-max").click(); }
  else await section.locator("#lending-amount").fill(String(amount));
  await section.locator("button.gmd-button").click();
  await section.locator(".gmd-lending-done").waitFor({ timeout: 180000 });
};
if (process.env.E2E_FLOW === "lending") {
  try {
    await step("open USTX and connect", async () => {
      await page.goto(SITE + "/products/ustx", { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.getByRole("button", { name: "Connect OKX Wallet" }).first().click();
      await page.getByText("USTX in wallet").waitFor({ timeout: 60000 });
    });
    await step("buy $80 at the fund", () => buyAtFund(80));
    await step("deposit 0.5 USTX as collateral", () => lendingStep("Deposit USTX", "0.5"));
    await step("borrow $12", () => lendingStep("Borrow", "12"));
    await step("repay the loan (max)", () => lendingStep("Repay", null, true));
    await step("withdraw collateral (max)", () => lendingStep("Withdraw USTX", null, true));
    await step("lend $20", () => lendingStep("Lend dUSD", "20"));
    await step("withdraw lent dUSD (max)", () => lendingStep("Withdraw dUSD", null, true));
  } catch {}
} else if (process.env.E2E_FLOW === "pools") {
  try {
    await step("open Pools and connect", async () => {
      await page.goto(SITE + "/pools", { waitUntil: "domcontentloaded", timeout: 90000 });
      const provide = page.locator("#provide");
      if (!(await provide.count())) await page.getByText(/Constant product|USTX\/dUSD/).first().click();
      const connect = page.locator("#provide").getByRole("button", { name: "Connect OKX Wallet" });
      if (await connect.isVisible().catch(() => false)) await connect.click();
      await page.locator("#provide").getByRole("button", { name: "Add", exact: true }).waitFor({ timeout: 60000 });
    });
    if (!process.env.SKIP_ADD) await step("add $40 of liquidity from demo dollars", async () => {
      const provide = page.locator("#provide");
      await provide.getByRole("button", { name: "Add", exact: true }).click();
      await provide.getByRole("button", { name: "dUSD only" }).first().click();
      await provide.locator("#liquidity-dollars-only").fill("40");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("#provide button.gmd-button")].find(x => /Add liquidity/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 60000 });
      await provide.getByRole("button", { name: /Add liquidity/ }).click();
      await page.getByText("Liquidity added").first().waitFor({ timeout: 240000 });
      await page.getByRole("button", { name: "Done", exact: true }).first().click();
    });
    await step("withdraw all liquidity as demo dollars", async () => {
      const provide = page.locator("#provide");
      await provide.getByRole("button", { name: "Withdraw", exact: true }).first().click();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('#provide [aria-label="Part of your liquidity"] button')].find(x => x.textContent === "All"); return b && !b.disabled; }, null, { timeout: 90000 });
      await provide.locator('[aria-label="Part of your liquidity"]').getByRole("button", { name: "All" }).click();
      await provide.locator('[aria-label="Receive"]').getByRole("button", { name: "dUSD only" }).click();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("#provide button.gmd-button")].find(x => /^Withdraw/.test(x.textContent.trim())); return b && !b.disabled; }, null, { timeout: 60000 });
      await provide.locator("button.gmd-button", { hasText: /^Withdraw/ }).click();
      await page.getByText(/Liquidity withdrawn|Withdrawn/).first().waitFor({ timeout: 240000 });
    });
  } catch {}
} else try {
  await step("open USTX and connect", async () => {
    await page.goto(SITE + "/products/ustx", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("button", { name: "Connect OKX Wallet" }).first().click();
    await page.getByText("USTX in wallet").waitFor({ timeout: 60000 });
  });
  const claim = page.getByRole("button", { name: /Get .* demo dollars/ });
  if (await claim.isVisible().catch(() => false)) await step("claim demo dollars", async () => {
    await claim.click();
    await page.getByText(/More demo dollars in/).waitFor({ timeout: 120000 });
  });
  for (const venue of ["fund", "pool", "v4"]) {
    await step(`buy $60 via ${venue}`, async () => {
      await page.getByRole("button", { name: "Buy", exact: true }).click();
      await page.locator("#wallet-amount").fill("60");
      const radio = page.locator(`input[name="wallet-venue"][value="${venue}"]`);
      await radio.waitFor({ timeout: 30000 });
      await page.waitForFunction(v => { const r = document.querySelector(`input[name="wallet-venue"][value="${v}"]`); return r && !r.disabled; }, venue, { timeout: 60000 });
      await radio.check({ force: true });
      await page.getByRole("button", { name: /Review order/ }).click();
      await page.getByRole("button", { name: /Confirm in wallet/ }).click();
      await page.getByText(/Order filled|Added to your basket/).first().waitFor({ timeout: 180000 });
      await page.getByRole("button", { name: /Place another order/ }).click();
    });
  }
  await step("sell all at the fund", async () => {
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    await page.locator(".gmd-order-presets").getByRole("button", { name: "All", exact: true }).click();
    await page.waitForFunction(() => { const r = document.querySelector('input[name="wallet-venue"][value="fund"]'); return r && !r.disabled; }, null, { timeout: 60000 });
    await page.locator('input[name="wallet-venue"][value="fund"]').check({ force: true });
    await page.getByRole("button", { name: /Review order/ }).click();
    await page.getByRole("button", { name: /Confirm in wallet/ }).click();
    await page.getByText(/Order filled|Taken out of your basket/).first().waitFor({ timeout: 180000 });
  });
  await step("portfolio shows the wallet", async () => {
    await page.goto(SITE + "/portfolio", { waitUntil: "domcontentloaded" });
    await page.getByText(account.address.slice(0, 6), { exact: false }).first().waitFor({ timeout: 60000 });
  });
} catch {}
console.log("transactions", sent.length, sent.join(" "));
console.log("problems", JSON.stringify([...new Set(problems)].slice(0, 20), null, 1));
await browser.close();
