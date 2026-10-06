/**
 * Ganymede's MCP server: the Model Context Protocol over Streamable HTTP, one JSON response per
 * request, no session. AI agents (an OKX.AI A2MCP client, Claude, ChatGPT and others) call its
 * tools to read USTX on X Layer: the NAV recorded there, the check of that record against its
 * document, the holdings behind a share, quotes at the fund and the three pools, the unsigned
 * transactions a wallet would sign for an order, the pools' results for their providers, and the
 * market's latest activity.
 *
 * Every tool reads; none signs, sends or writes. An order still needs the user's own wallet to sign
 * it. Demo dollars and USTX on X Layer Testnet have no value.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_SERVER_INFO = { name: "ganymede-ustx", title: "Ganymede USTX", version: "1.0.0" } as const;

export const MCP_INSTRUCTIONS = [
  "Ganymede runs USTX, the US Tech Basket: one share tracks nine tokenized US tech stocks (AAPLx, MSFTx, NVDAx, AMZNx, METAx, TSLAx, GOOGLx, ORCLx, PLTRx) on X Layer.",
  "Every five minutes the xStocks are priced through OKX OnchainOS and the NAV, with a SHA-256 fingerprint of its full document, is recorded in a registry on X Layer Testnet.",
  "Use get_ustx_nav for the latest NAV and whether it is still valid, verify_ustx_nav to check that record against its document, get_ustx_holdings for what one share holds,",
  "quote_ustx_order to compare the fund at the NAV with the three USTX/dUSD pools (constant-product, Uniswap v4 held at the NAV, and the range pool of providers' own bins), prepare_ustx_order for the unsigned transactions a user's wallet would sign for such an order, get_ustx_pools for the pools and their results for liquidity providers, and get_ustx_market_activity for the latest trades.",
  "Before saying an order can be placed now, check usableForOrders from get_ustx_nav: while the NAV record is over an hour old the fund, the lending market and the two NAV-guarded pools refuse orders, and the constant-product pool's price drifts from the NAV.",
  "Markets also lists five more baskets, two covered-call funds and a step-down autocallable note: list_funds lists every product, and get_fund reads one (a basket's weights, the month's call, the note's levels and knock-in). Only USTX can be bought.",
  "All tools read only, and prepare_ustx_order returns transactions unsigned. Investing uses demo dollars with no value on X Layer Testnet; nothing here is investment advice or an offer. Orders are placed by the user's own wallet, on https://ganymede-xlayer.gana003.workers.dev/products/ustx or from the transactions prepare_ustx_order returns. Each address may make about 30 tool calls a minute.",
].join(" ");

export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** A tool's argument the caller got wrong: reported to the model as a tool error it can correct. */
export class ToolInputError extends Error {}

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  "Access-Control-Max-Age": "86400",
};
const MAX_BODY_BYTES = 64 * 1024;
/** A batch, which the 2025-06-18 protocol no longer sends, holds at most this many messages, answered one after another. */
const MAX_BATCH = 4;
/** Tool calls one address may make a minute, counted per server instance: each can read X Layer several times. */
export const MCP_TOOL_CALLS_PER_MINUTE = 30;
const toolCalls = new Map<string, number[]>();

/** Whether `client` may make another tool call now; counts it if so. */
export function takeToolCall(client: string, now = Date.now()): boolean {
  const recent = (toolCalls.get(client) ?? []).filter(at => now - at < 60_000);
  if (recent.length >= MCP_TOOL_CALLS_PER_MINUTE) {
    toolCalls.set(client, recent);
    return false;
  }
  recent.push(now);
  toolCalls.set(client, recent);
  // Forget addresses idle for a minute, so the map stays small.
  if (toolCalls.size > 5_000) for (const [key, times] of toolCalls) if (times.every(at => now - at >= 60_000)) toolCalls.delete(key);
  return true;
}

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === null ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store" },
  });
}

const failure = (id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const validId = (id: unknown): id is string | number => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));

/** One JSON-RPC message: a response, or null for a notification. */
async function handleMessage(message: JsonRpcRequest, tools: readonly McpTool[], client: string): Promise<JsonRpcResponse | null> {
  const isNotification = !("id" in message);
  const id = validId(message.id) ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || (!isNotification && id === null)) {
    return isNotification ? null : failure(id, -32600, "Invalid request.");
  }
  if (isNotification) return null;
  const params = (message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS } };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0", id,
        result: { tools: tools.map(tool => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })) },
      };
    case "tools/call": {
      const tool = tools.find(item => item.name === params.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      if (!takeToolCall(client)) return failure(id, -32000, `Too many tool calls from this address: at most ${MCP_TOOL_CALLS_PER_MINUTE} a minute. Try again shortly.`);
      const args = (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await tool.run(args);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false } };
      } catch (error) {
        // A wrong argument or an unreadable chain is the tool's result, which the model can act on;
        // upstream details stay in the operator log.
        if (!(error instanceof ToolInputError)) console.error(`MCP tool ${tool.name} failed`, (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[url]"));
        const text = error instanceof ToolInputError ? error.message : "X Layer could not be read right now. Try again in a minute.";
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } };
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${message.method}`);
  }
}

/**
 * The MCP endpoint: POST carries JSON-RPC messages (one, or a batch), answered as JSON; a request
 * of notifications only is accepted with 202. GET offers no event stream (405), as the protocol
 * allows. Anyone may call it: it reads public chain state and holds no session.
 */
export async function handleMcp(request: Request, tools: readonly McpTool[]): Promise<Response> {
  if (request.method === "OPTIONS") return reply(null, 204);
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "This MCP endpoint takes JSON-RPC over POST (Streamable HTTP) and offers no event stream." }), {
      status: 405, headers: { ...CORS, Allow: "POST, OPTIONS", "Content-Type": "application/json" },
    });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(failure(null, -32600, "Request too large."), 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(failure(null, -32700, "Parse error."), 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0 || messages.some(message => !message || typeof message !== "object" || Array.isArray(message))) {
    return reply(failure(null, -32600, "Invalid request."), 400);
  }
  if (messages.length > MAX_BATCH) return reply(failure(null, -32600, `A batch holds at most ${MAX_BATCH} messages.`), 400);
  const client = request.headers.get("cf-connecting-ip") ?? "unknown";
  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    const response = await handleMessage(message as JsonRpcRequest, tools, client);
    if (response) responses.push(response);
  }
  if (responses.length === 0) return reply(null, 202);
  const limited = responses.every(response => "error" in response && response.error?.code === -32000);
  return reply(Array.isArray(body) ? responses : responses[0], limited ? 429 : 200);
}
