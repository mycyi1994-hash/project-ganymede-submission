// A browser test of the production app with a team test wallet: Playwright opens the site with the
// wallet injected as window.okxwallet, and every transaction the app asks for is signed here by a
// test key (kept in onchain/.stress/e2e-keys.json, git-ignored) and sent to X Layer Testnet.
//
// Flows (E2E_FLOW): default buys $60 at the fund, the constant-product pool and the v4 pool and
// sells everything at the fund; "lending" posts collateral, borrows, repays, withdraws, lends and
// withdraws; "pools" adds liquidity from demo dollars and withdraws it all with the one-button view (SKIP_ADD=1 only withdraws;
// E2E_STRATEGY=Curve, "Spot + Curve" or Custom chooses a strategy first, so part or all of it goes to the v4 pool).
// E2E_SITE points it at another deployment, such as a local `npm run dev`; E2E_RPC sends every chain request, the
// page's and the wallet's, to another node, such as a local fork (`npx hardhat node --fork …`); E2E_TIMEOUT_MS
// lengthens the waits for a slow fork.
// READ_ONLY=1 only visits the pages. It reports page errors, console errors and HTTP errors.
//
// Run from onchain/: ADMIN_PRIVATE_KEY=… node scripts/e2e-wallet.mjs
//   PLAYWRIGHT_MODULE, CHROMIUM_PATH, BROWSER_PROXY and BROWSER_ARGS adapt it to the machine;
//   SHOTS=dir saves a screenshot after each step.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const SITE = process.env.E2E_SITE ?? "https://ganymede-xlayer.gana003.workers.dev";
const SHOTS = process.env.SHOTS;
const RPC = process.env.E2E_RPC;
const WAIT = Number(process.env.E2E_TIMEOUT_MS ?? 240000);
const chain = { id: 1952, name: "X Layer Testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC ?? "https://testrpc.xlayer.tech/terigon"] } } };
const transport = http(undefined, { retryCount: 4, retryDelay: 1500, timeout: WAIT });
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
if (RPC) await page.route(/testrpc\.xlayer\.tech/, async route => route.fulfill({ response: await route.fetch({ url: RPC, timeout: WAIT }) }));
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
// Each action is a row's button on Borrow, which opens its dialog: the amount, the action, then Done.
const lendingStep = async (label, amount, useMax = false) => {
  await page.locator("#borrow").getByRole("button", { name: label, exact: true }).first().click();
  const dialog = page.locator(".gmd-lending-dialog");
  if (useMax) { await dialog.locator(".gmd-lending-max").waitFor({ timeout: 60000 }); await dialog.locator(".gmd-lending-max").click(); }
  else await dialog.locator("#lending-amount").fill(String(amount));
  await dialog.locator("button.gmd-lending-submit").click();
  await dialog.locator(".gmd-lending-done").waitFor({ timeout: 180000 });
  await dialog.getByRole("button", { name: "Done" }).click();
};
if (process.env.E2E_FLOW === "lending") {
  try {
    await step("open USTX and connect", async () => {
      await page.goto(SITE + "/products/ustx", { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.getByRole("button", { name: "Connect OKX Wallet" }).first().click();
      await page.getByText("USTX in wallet").waitFor({ timeout: 60000 });
    });
    await step("buy $80 at the fund", () => buyAtFund(80));
    await step("open Borrow", async () => {
      await page.goto(SITE + "/borrow", { waitUntil: "domcontentloaded", timeout: 90000 });
      const connect = page.getByRole("button", { name: "Connect OKX Wallet" }).first();
      if (await connect.isVisible().catch(() => false)) await connect.click();
      await page.locator("#borrow .gmd-lending-summary").getByText(/supplied ·/).waitFor({ timeout: 60000 });
    });
    await step("deposit 0.5 USTX as collateral", () => lendingStep("Deposit USTX", "0.5"));
    await step("borrow $12", () => lendingStep("Borrow dUSD", "12"));
    await step("repay the loan (max)", () => lendingStep("Repay dUSD", null, true));
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
      await page.locator("#liquidity-simple").waitFor({ timeout: WAIT });
    });
    // The one-button view: an amount of demo dollars and Add liquidity; Withdraw all returns everything as demo dollars.
    if (!process.env.SKIP_ADD) await step("add $40 of liquidity from demo dollars with one button", async () => {
      const provide = page.locator("#provide");
      if (process.env.E2E_STRATEGY) await provide.getByRole("radio", { name: new RegExp(`^${process.env.E2E_STRATEGY.replace("+", "\\+")}`) }).click();
      await provide.locator("#liquidity-simple").fill("40");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("#provide button.gmd-button")].find(x => /Add liquidity/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: WAIT });
      await provide.getByRole("button", { name: /Add liquidity/ }).click();
      await page.getByText(/Liquidity added|Position #\d+ opened/).first().waitFor({ timeout: WAIT });
      await page.getByRole("button", { name: "Done", exact: true }).first().click();
    });
    await step("withdraw all liquidity as demo dollars with one button", async () => {
      const provide = page.locator("#provide");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("#provide button.gmd-button")].find(x => /Withdraw all as demo dollars/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: WAIT });
      await provide.getByRole("button", { name: "Withdraw all as demo dollars" }).click();
      await page.getByText(/Liquidity withdrawn/).first().waitFor({ timeout: WAIT });
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
