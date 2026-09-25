/**
 * Publishes a NAV record for a basket defined by a configuration file, as a second issuer: with its
 * own wallet, to its own GanymedeNavRegistry on X Layer Testnet, priced from the X Layer mainnet
 * pools, which need no API key. Nothing here uses USTX's code path, keys or schedule. Put the
 * issuer's key in .env as ISSUER_PRIVATE_KEY (never commit it), then:
 *
 *   npm run basket:publish -- public/baskets/mag3/basket.json --init
 *   npm run basket:publish -- public/baskets/mag3/basket.json
 *
 * --init deploys the registry with the issuer wallet as its administrator and publisher, fixes the
 * units so one share is worth $100 at the current pool prices, and writes both into the
 * configuration. Every run writes the record's document under public/, where this site serves it
 * once deployed, sends the record and checks it as a visitor's browser does, reading the document
 * from disk. Visitors see it after the next site deploy; until then the live check reports that the
 * document is not served. Testnet only; viem comes from onchain/ (run npm ci there first). The key is
 * read from the environment and never printed.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../lib/engine/fixed.ts";
import { readPoolPrices, XSTOCK_POOLS } from "../lib/xstocks/pool-prices.ts";
import { basketDocument, fixUnits, parseBasketConfig, verifyBasket } from "../lib/xstocks/basket-config.ts";

const require = createRequire(new URL("../onchain/package.json", import.meta.url));
const { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const artifact = JSON.parse(readFileSync(new URL("../onchain/artifacts/contracts/GanymedeNavRegistry.sol/GanymedeNavRegistry.json", import.meta.url), "utf8"));

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const init = args.includes("--init");
if (!file) {
  console.error("Usage: npm run basket:publish -- <basket.json> [--init]   (ISSUER_PRIVATE_KEY in .env)");
  process.exit(1);
}
const key = process.env.ISSUER_PRIVATE_KEY ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set ISSUER_PRIVATE_KEY in .env to the issuer wallet's key. Never commit it.");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, "utf8"));
if (raw.registry?.chainId !== 1952) throw new Error("Baskets are published on X Layer Testnet (1952) only.");
if (!String(raw.documents).startsWith("/")) throw new Error("This script writes documents served by this site; use a path starting with /.");
const chain = defineChain({ id: 1952, name: raw.registry.network, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [raw.registry.rpcUrl] } } });
const account = privateKeyToAccount(key);
const client = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
if ((await client.getChainId()) !== 1952) throw new Error("The RPC is not X Layer Testnet.");
console.log(`issuer     ${account.address}`);

// One price per constituent: its X Layer mainnet pool, every pool read at the same block.
for (const row of raw.constituents) {
  const pool = XSTOCK_POOLS.find((entry) => entry.symbol === row.symbol);
  if (!pool || pool.token !== row.address) throw new Error(`${row.symbol} at ${row.address} has no pinned X Layer pool.`);
}
const pools = await readPoolPrices();
const prices = new Map(pools.prices.map((price) => [price.symbol, { priceMicros: BigInt(price.priceMicros), source: `uniswap-v3:${price.pool}` }]));
console.log(`prices     X Layer block ${pools.blockNumber} (${pools.blockTime})`);

if (init) {
  if (raw.registry.address) throw new Error("This basket already has a registry. Remove it from the configuration to start again.");
  const deployment = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [account.address, account.address] });
  const receipt = await client.waitForTransactionReceipt({ hash: deployment });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Registry deployment failed: ${deployment}`);
  raw.registry.address = receipt.contractAddress.toLowerCase();
  raw.registry.deploymentTransaction = deployment;
  raw.productKey = keccak256(stringToHex(raw.id));
  raw.fixedAt = pools.blockTime;
  const units = fixUnits(raw.constituents, new Map([...prices].map(([symbol, price]) => [symbol, price.priceMicros])));
  raw.constituents.forEach((row, index) => { row.unitsWad = units[index]; });
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`registry   ${raw.registry.address} (tx ${deployment})`);
  console.log(`product    ${raw.id} ${raw.productKey}`);
  console.log(`fixed      ${raw.fixedAt}: ${raw.constituents.map((row) => `${row.symbol} ${row.unitsWad}`).join(", ")}`);
}

// The public RPC is load-balanced: a node may not have seen the latest block yet, so reads retry briefly.
async function retry(read) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await read(); } catch (error) { if (attempt >= 10) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const config = parseBasketConfig(raw);
const registry = { address: config.registry.address, abi: artifact.abi };
const publisher = await retry(() => client.readContract({ ...registry, functionName: "publisher" }));
if (publisher.toLowerCase() !== account.address.toLowerCase()) throw new Error("This key is not the registry's publisher.");
const { composition, canonical } = basketDocument(config, prices, pools.blockTime);
const holdingsHash = await sha256Hex(canonical);
const effectiveAt = BigInt(Math.floor(Date.parse(composition.asOf) / 1000));
const [, , , lastEffectiveAt] = await retry(() => client.readContract({ ...registry, functionName: "latestNav", args: [config.productKey] }));
if (effectiveAt <= lastEffectiveAt) throw new Error("The pools have no block newer than the last record. Try again in a few seconds.");

// The document is written before the record is sent, so a record never exists without its document;
// it reaches visitors with the next deploy of the site.
const documentPath = path.join("public", config.documents.replace("{hash}", holdingsHash));
mkdirSync(path.dirname(documentPath), { recursive: true });
writeFileSync(documentPath, canonical);
const transaction = await wallet.writeContract({ ...registry, functionName: "publishNav", args: [config.productKey, BigInt(composition.navPerShareMicros), 0n, holdingsHash, effectiveAt] });
const receipt = await client.waitForTransactionReceipt({ hash: transaction });
if (receipt.status !== "success") throw new Error(`publishNav reverted: ${transaction}`);
console.log(`recorded   NAV ${(Number(composition.navPerShareMicros) / 1e6).toFixed(6)} at ${composition.asOf}, fingerprint ${holdingsHash}`);
console.log(`           tx ${transaction}, block ${receipt.blockNumber}`);

// The records list lets the page link each record's transaction; it is not evidence itself.
const recordsPath = path.join(path.dirname(file), "records.json");
let records = [];
try { records = JSON.parse(readFileSync(recordsPath, "utf8")); } catch {}
records.unshift({ effectiveAt: composition.asOf, navPerShareMicros: composition.navPerShareMicros, holdingsHash, transactionHash: transaction });
writeFileSync(recordsPath, `${JSON.stringify(records.slice(0, 50), null, 2)}\n`);

// Check the record the way the browser does. The public RPC is load-balanced, so wait for the new record.
const site = "https://site.invalid";
const fetcher = async (url, init) => url.startsWith(`${site}/`) ? new Response(readFileSync(path.join("public", new URL(url).pathname))) : fetch(url, init);
for (let attempt = 0; ; attempt += 1) {
  const check = await verifyBasket(config, { base: site, fetcher });
  if (check.record?.holdingsHash.toLowerCase() === holdingsHash.toLowerCase()) {
    for (const name of ["chain", "hash", "nav", "definition"]) console.log(`check      ${name.padEnd(10)} ${check[name].state}  ${check[name].detail}`);
    if (!["chain", "hash", "nav", "definition"].every((name) => check[name].state === "pass")) process.exitCode = 1;
    console.log(`next       deploy the site so it serves ${documentPath.slice("public".length)}`);
    break;
  }
  if (attempt >= 10) throw new Error("The RPC has not returned the new record yet; check it on the explorer.");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
