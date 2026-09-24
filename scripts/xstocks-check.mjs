/**
 * Readiness check for the GMD US TECH x basket. Run it locally before deploying:
 *
 *   npm run xstocks:check              # discover + verify + prices
 *   npm run xstocks:check -- discover  # find xStocks addresses on X Layer via OnchainOS token search
 *   npm run xstocks:check -- verify    # confirm XSTOCKS_ADDRESSES on chain (symbol/decimals via X Layer RPC)
 *   npm run xstocks:check -- prices    # fetch live prices exactly as the engine does
 *
 * Reads OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE / OKX_PROJECT_ID and
 * XSTOCKS_ADDRESSES from the environment (or .env).
 */
import { constituentsWithAddresses, formatMicros, XSTOCKS_CHAIN, XSTOCKS_CONSTITUENTS } from "../lib/xstocks/basket.ts";
import { fetchXStockQuotes, onchainOsCredentials, signedHeaders } from "../lib/xstocks/prices.ts";

const command = process.argv[2] ?? "all";
const credentials = onchainOsCredentials(process.env);

// Trial-tier OnchainOS keys allow 1 request per second, so space every call.
const ONCHAINOS_SPACING_MS = 1_100;
let lastOnchainOsCall = 0;
async function paced(call) {
  const wait = lastOnchainOsCall + ONCHAINOS_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    return await call();
  } finally {
    lastOnchainOsCall = Date.now();
  }
}

function decodeAbiString(hex) {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length === 64) return Buffer.from(data, "hex").toString("utf8").replace(/\0+$/, "");
  const length = Number(BigInt(`0x${data.slice(64, 128)}`));
  return Buffer.from(data.slice(128, 128 + length * 2), "hex").toString("utf8");
}

async function ethCall(to, data) {
  const response = await fetch(XSTOCKS_CHAIN.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

async function discover() {
  console.log(`\n── discover: OnchainOS token search on chain ${XSTOCKS_CHAIN.chainIndex} ──`);
  if (!credentials) return console.log("  skipped: set OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE");
  const suggestions = [];
  for (const constituent of XSTOCKS_CONSTITUENTS) {
    const requestPath = `/api/v6/dex/market/token/search?chains=${XSTOCKS_CHAIN.chainIndex}&search=${encodeURIComponent(constituent.symbol)}`;
    const response = await paced(async () => fetch(`${credentials.baseUrl}${requestPath}`, { headers: await signedHeaders(credentials, "GET", requestPath) }));
    const payload = await response.json().catch(() => ({}));
    if (String(payload.code) !== "0") {
      console.log(`  ${constituent.symbol.padEnd(6)} error ${response.status}: ${payload.msg ?? JSON.stringify(payload).slice(0, 160)}`);
      continue;
    }
    const rows = (payload.data ?? []).filter((row) => String(row.chainIndex ?? XSTOCKS_CHAIN.chainIndex) === XSTOCKS_CHAIN.chainIndex);
    if (rows.length === 0) console.log(`  ${constituent.symbol.padEnd(6)} no match`);
    for (const row of rows.slice(0, 4)) {
      const exact = String(row.tokenSymbol ?? "").toLowerCase() === constituent.symbol.toLowerCase();
      console.log(`  ${constituent.symbol.padEnd(6)} ${exact ? "EXACT" : "     "} ${row.tokenSymbol} · ${row.tokenName ?? ""} · ${row.tokenContractAddress}`);
    }
    const exact = rows.filter((row) => String(row.tokenSymbol ?? "").toLowerCase() === constituent.symbol.toLowerCase());
    if (exact.length === 1) suggestions.push(`${constituent.symbol}=${exact[0].tokenContractAddress}`);
  }
  if (suggestions.length > 0) {
    console.log("\n  Candidate line — confirm every address on the xStocks site before using it:");
    console.log(`  XSTOCKS_ADDRESSES=${suggestions.join(",")}`);
  }
}

async function verify() {
  console.log(`\n── verify: XSTOCKS_ADDRESSES against ${XSTOCKS_CHAIN.rpcUrl} ──`);
  for (const constituent of constituentsWithAddresses(process.env.XSTOCKS_ADDRESSES)) {
    if (!constituent.address) {
      console.log(`  MISSING ${constituent.symbol}`);
      continue;
    }
    try {
      const [symbolHex, decimalsHex] = await Promise.all([ethCall(constituent.address, "0x95d89b41"), ethCall(constituent.address, "0x313ce567")]);
      const symbol = decodeAbiString(symbolHex);
      const ok = symbol.toLowerCase() === constituent.symbol.toLowerCase();
      console.log(`  ${ok ? "ok     " : "MISMATCH"} ${constituent.symbol.padEnd(6)} ${constituent.address} symbol=${symbol} decimals=${Number(BigInt(decimalsHex))}`);
    } catch (error) {
      console.log(`  FAIL    ${constituent.symbol.padEnd(6)} ${constituent.address}: ${error.message}`);
    }
  }
}

async function prices() {
  console.log("\n── prices: OnchainOS DEX market price (as the engine calls it) ──");
  const { quotes, warnings } = await paced(() => fetchXStockQuotes(credentials, constituentsWithAddresses(process.env.XSTOCKS_ADDRESSES)));
  for (const quote of quotes.values()) {
    const age = Math.round((Date.now() - Date.parse(quote.time)) / 60_000);
    console.log(`  ${quote.symbol.padEnd(6)} $${formatMicros(quote.priceMicros, 4).padStart(12)}  ${quote.time} (${age} min old)`);
  }
  for (const warning of warnings) console.log(`  WARN ${warning}`);
  console.log(`\n  ${quotes.size}/${XSTOCKS_CONSTITUENTS.length} priced — the engine publishes only when all are priced and fresh.`);
}

const steps = { discover, verify, prices };
for (const step of command === "all" ? Object.values(steps) : [steps[command]]) {
  if (!step) {
    console.error(`unknown command "${command}" — use discover | verify | prices`);
    process.exit(1);
  }
  await step();
}
