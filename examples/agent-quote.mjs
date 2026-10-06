// A minimal AI-agent client for Ganymede's MCP server: no dependencies, Node 18 or later.
//
//   node examples/agent-quote.mjs                      # quotes a $500 purchase of USTX
//   node examples/agent-quote.mjs sell 2.5             # quotes selling 2.5 USTX
//   node examples/agent-quote.mjs buy 500 0xYourWallet # also prepares the transactions that wallet would sign
//
// It does what an agent does: initialize, list the tools, check that orders are open, quote, and
// with a wallet address prepare the unsigned transactions, printing what a model would read. Nothing
// is signed or sent, and demo dollars and USTX on X Layer Testnet have no value.
const MCP = process.env.GANYMEDE_MCP ?? "https://ganymede-xlayer.gana003.workers.dev/mcp";
const [side = "buy", amount = "500", wallet] = process.argv.slice(2);

let id = 0;
async function rpc(method, params) {
  const response = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function tool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
  return result.structuredContent;
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ganymede-example", version: "1.1.0" } });
console.log(`Connected to ${init.serverInfo.title} (protocol ${init.protocolVersion})`);
const { tools } = await rpc("tools/list");
console.log(`Tools: ${tools.map(item => item.name).join(", ")}\n`);

const nav = await tool("get_ustx_nav");
console.log(`NAV ${nav.navUsd} per USTX, effective ${nav.effectiveAt}`);
console.log(nav.usableForOrders ? "Orders are open: the fund accepts this record." : `Orders are paused: ${nav.ordersNote}`);

const quote = await tool("quote_ustx_order", { side, amount: Number(amount) });
console.log(`\n${side === "buy" ? "Buying with" : "Selling"} ${quote.amount}:`);
for (const [venue, place] of Object.entries(quote.venues)) {
  if (!place) continue;
  const gap = quote.vsLastNavPercent?.[venue];
  console.log(`  ${place.name.padEnd(54)} ${place.receive ? `${place.receive}${gap === undefined ? "" : ` (${gap >= 0 ? "+" : ""}${gap}% against the last NAV)`}` : `unavailable (${place.unavailable})`}${quote.best === venue ? "  ← gives the most" : ""}`);
}
for (const warning of quote.warnings ?? []) console.log(`  ! ${warning}`);

if (wallet) {
  const prepared = await tool("prepare_ustx_order", { side, amount: Number(amount), wallet });
  console.log(`\nFor ${prepared.from} on ${prepared.chain.chainName} (${prepared.chain.chainId}), holding ${prepared.balance}:`);
  if (prepared.transactions.length === 0) console.log(`  nothing to sign: ${prepared.unavailable}`);
  for (const [index, transaction] of prepared.transactions.entries()) console.log(`  ${index + 1}. ${transaction.purpose}\n     to ${transaction.to}\n     data ${transaction.data.slice(0, 74)}…`);
  if (prepared.warning) console.log(`  ! ${prepared.warning}`);
  if (prepared.transactions.length) console.log(`\n${prepared.howToSign}`);
}
console.log(`\n${quote.howToExecute}\n${quote.environment}`);
