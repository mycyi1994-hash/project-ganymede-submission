// A minimal AI-agent client for Ganymede's MCP server: no dependencies, Node 18 or later.
//
//   node examples/agent-quote.mjs            # quotes a $500 purchase of USTX
//   node examples/agent-quote.mjs sell 2.5   # quotes selling 2.5 USTX
//
// It does what an agent does: initialize, list the tools, then call two of them, and prints what a
// model would read. Everything is read-only, and demo dollars and USTX have no value.
const MCP = process.env.GANYMEDE_MCP ?? "https://ganymede-xlayer.gana003.workers.dev/mcp";
const [side = "buy", amount = "500"] = process.argv.slice(2);

let id = 0;
async function rpc(method, params) {
  const response = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ganymede-example", version: "1.0.0" } });
console.log(`Connected to ${init.serverInfo.title} (protocol ${init.protocolVersion})`);
const { tools } = await rpc("tools/list");
console.log(`Tools: ${tools.map(tool => tool.name).join(", ")}\n`);

const nav = (await rpc("tools/call", { name: "get_ustx_nav", arguments: {} })).structuredContent;
console.log(`NAV ${nav.navUsd} per USTX, effective ${nav.effectiveAt}`);

const call = await rpc("tools/call", { name: "quote_ustx_order", arguments: { side, amount: Number(amount) } });
if (call.isError) throw new Error(call.content[0].text);
const quote = call.structuredContent;
console.log(`\n${side === "buy" ? "Buying with" : "Selling"} ${quote.amount}:`);
for (const [venue, place] of Object.entries(quote.venues)) {
  console.log(`  ${place.name.padEnd(36)} ${place.receive ?? `unavailable (${place.unavailable})`}${quote.best === venue ? "  ← gives the most" : ""}`);
}
console.log(`\n${quote.howToExecute}\n${quote.environment}`);
