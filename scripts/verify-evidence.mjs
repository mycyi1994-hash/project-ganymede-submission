/**
 * Re-checks an evidence file downloaded from the USTX verification page. No credentials:
 *
 *   npm run verify:evidence -- ustx-evidence.json            # document checks + X Layer receipt
 *   npm run verify:evidence -- ustx-evidence.json --offline  # document checks only
 *   npm run verify:evidence -- ustx-evidence.json --rpc <url>
 */
import { readFile } from "node:fs/promises";
import { parseEvidence, verifyEvidence } from "../lib/xstocks/evidence.ts";
import { formatUsdMicros } from "../lib/nav-display.ts";

const args = process.argv.slice(2);
let file = null, rpcUrl, offline = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--offline") offline = true;
  else if (args[index] === "--rpc") rpcUrl = args[++index];
  else file ??= args[index];
}
if (!file) {
  console.error("Usage: npm run verify:evidence -- <evidence.json> [--offline] [--rpc <url>]");
  process.exit(2);
}

let bundle;
try {
  bundle = parseEvidence(JSON.parse(await readFile(file, "utf8")));
} catch (error) {
  console.error(`Cannot read ${file}: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

console.log(`Ganymede evidence check: ${file}`);
console.log(`Record: ${bundle.product.ticker} NAV ${formatUsdMicros(bundle.record.navPerShareMicros, 4)} at ${bundle.record.effectiveAt}, fingerprint ${bundle.record.holdingsHash.slice(0, 18)}…`);
const results = await verifyEvidence(bundle, { offline, rpcUrl });
for (const result of results) console.log(`[${result.state.toUpperCase()}] ${result.label}: ${result.detail}`);
const failed = results.some(result => result.state === "fail");
const skipped = results.some(result => result.state === "skip");
console.log(`Result: ${failed ? "FAIL" : skipped ? "PASS (document checks only)" : "PASS"}`);
console.log(`Scope: ${bundle.scope}`);
process.exit(failed ? 1 : 0);
