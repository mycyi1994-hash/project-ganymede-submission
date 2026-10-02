/**
 * Ask USTX: answers visitors' questions about USTX with an OpenAI model that reads X Layer through
 * the same read-only tools as the MCP server (`/mcp`). The model sees only what the tools return,
 * so every figure in an answer comes from the registry, the fund and the pools when it is asked.
 *
 * It never signs, sends or writes anything on chain, gives no investment advice, and says that
 * demo dollars and USTX have no value. Each question is counted against a daily allowance per
 * visitor and for the whole site, kept in the engine state table, so the API key cannot be run up.
 */
import { ToolInputError, type McpTool } from "../mcp/server";
import { sha256Hex } from "../engine/fixed";

export const ASSISTANT_DEFAULT_MODEL = "gpt-5-mini";
export const ASSISTANT_LIMITS = {
  messages: 12,
  messageChars: 1_000,
  totalChars: 8_000,
  toolRounds: 4,
  toolCallsPerRound: 4,
  toolResultChars: 8_000,
  perVisitorPerDay: 30,
  perSitePerDay: 400,
} as const;

export const ASSISTANT_SYSTEM_PROMPT = [
  "You are Ask USTX, the assistant on Ganymede, a demo fund app on X Layer Testnet.",
  "USTX, the US Tech Basket, is one share that tracks six tokenized US tech stocks (AAPLx, MSFTx, NVDAx, AMZNx, METAx, TSLAx). Every five minutes the xStocks are priced through OKX OnchainOS and the NAV, with a SHA-256 fingerprint of its document, is recorded in a registry on X Layer Testnet.",
  "Wallets invest demo dollars (dUSD) at the fund at the NAV, or trade on two USTX/dUSD pools: a constant-product pool kept near the NAV by an arbitrage keeper, and a Uniswap v4 pool whose hook moves it to each NAV record. USTX can also be posted as collateral to borrow dUSD.",
  "Answer from the tools: call them for any number, and give the time the figure is as of. If a tool fails, say so; never guess a figure.",
  "Demo dollars and USTX have no value; say so when money, returns or buying come up. Do not give investment advice, recommendations or predictions, and do not say whether to buy or sell. You can explain how something works and compare quotes as facts: say which venue gives the most, never that it is the best choice or what the visitor should do.",
  "You cannot place orders or connect wallets. Orders are placed by the visitor's own wallet on the USTX page (/products/ustx); liquidity on Pools (/pools); the checks on Transparency (/products/ustx/transparency).",
  "Reply in the visitor's language. Be brief: a few short sentences, or a short list with '- '. Plain text only: no tables, headings or bold.",
].join(" ");

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AskResult = { answer: string; toolsUsed: string[] };

export class AssistantError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The conversation a visitor sent, checked: user and assistant turns, ending with the user's question. */
export function parseConversation(body: unknown): ChatMessage[] {
  const raw = body && typeof body === "object" ? (body as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(raw) || raw.length === 0) throw new AssistantError("Ask a question.", 400, "no_question");
  const messages = raw.slice(-ASSISTANT_LIMITS.messages).map((item): ChatMessage => {
    const role = item && typeof item === "object" ? (item as { role?: unknown }).role : undefined;
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") throw new AssistantError("Each message needs a role and text.", 400, "bad_message");
    const text = content.trim();
    if (!text) throw new AssistantError("Ask a question.", 400, "no_question");
    if (text.length > ASSISTANT_LIMITS.messageChars) throw new AssistantError(`Keep each question under ${ASSISTANT_LIMITS.messageChars.toLocaleString("en-US")} characters.`, 400, "too_long");
    return { role, content: text };
  });
  if (messages[messages.length - 1].role !== "user") throw new AssistantError("Ask a question.", 400, "no_question");
  if (messages.reduce((sum, message) => sum + message.content.length, 0) > ASSISTANT_LIMITS.totalChars) throw new AssistantError("This conversation is too long. Start a new one.", 400, "too_long");
  return messages;
}

type D1 = { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } }; batch(statements: unknown[]): Promise<unknown> };

/**
 * Counts one question for the visitor (a hash of their address and the day, never the address
 * itself) and for the site, and refuses it past either daily allowance. The day's first question
 * clears earlier days' counts.
 */
export async function takeQuestion(db: D1, visitor: string, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const at = now.toISOString();
  const siteKey = `assistant:site:${day}`;
  const visitorKey = `assistant:visitor:${day}:${(await sha256Hex(`${day}:${visitor}`)).slice(0, 32)}`;
  const count = (key: string) => db.prepare("INSERT INTO engine_state (key, value, updated_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at").bind(key, at);
  await db.batch([count(siteKey), count(visitorKey)]);
  const read = async (key: string) => Number((await db.prepare("SELECT value FROM engine_state WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? 0);
  const [site, mine] = await Promise.all([read(siteKey), read(visitorKey)]);
  if (site === 1) await db.prepare("DELETE FROM engine_state WHERE key LIKE 'assistant:%' AND updated_at < ?").bind(`${day}T00:00:00.000Z`).run();
  if (mine > ASSISTANT_LIMITS.perVisitorPerDay) throw new AssistantError(`You have asked ${ASSISTANT_LIMITS.perVisitorPerDay} questions today. Ask again after 00:00 UTC.`, 429, "visitor_limit");
  if (site > ASSISTANT_LIMITS.perSitePerDay) throw new AssistantError("The assistant has answered all it can today. Ask again after 00:00 UTC.", 429, "site_limit");
}

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[]; error?: { code?: string; type?: string } };

const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}… (cut to ${limit.toLocaleString("en-US")} characters)` : text;

async function runTool(tools: readonly McpTool[], call: ToolCall): Promise<string> {
  const tool = tools.find(item => item.name === call.function.name);
  if (!tool) return `Unknown tool: ${call.function.name}`;
  let args: Record<string, unknown> = {};
  try {
    const parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch {
    return "The arguments were not valid JSON.";
  }
  try {
    return clip(JSON.stringify(await tool.run(args)), ASSISTANT_LIMITS.toolResultChars);
  } catch (error) {
    if (error instanceof ToolInputError) return error.message;
    console.error(`Ask USTX tool ${tool.name} failed`, (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[url]"));
    return "X Layer could not be read right now.";
  }
}

/**
 * One answer: the model may call the tools for up to four rounds before it must reply. Upstream
 * failures become an AssistantError with no detail from the provider.
 */
export async function askUstx(conversation: ChatMessage[], tools: readonly McpTool[], options: { apiKey: string; model?: string; fetcher?: typeof fetch }): Promise<AskResult> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model || ASSISTANT_DEFAULT_MODEL;
  const reasoning = /^(gpt-5|o\d)/.test(model);
  const messages: OpenAiMessage[] = [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }, ...conversation];
  const definitions = tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
  const toolsUsed: string[] = [];
  for (let round = 0; round <= ASSISTANT_LIMITS.toolRounds; round += 1) {
    const last = round === ASSISTANT_LIMITS.toolRounds;
    let response: Response;
    try {
      response = await fetcher("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model, messages, tools: definitions, tool_choice: last ? "none" : "auto",
          max_completion_tokens: reasoning ? 4_000 : 900,
          ...(reasoning ? { reasoning_effort: "low" } : { temperature: 0.2 }),
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      console.error("Ask USTX: the model could not be reached", error instanceof Error ? error.name : "error");
      throw new AssistantError("The assistant could not be reached. Try again in a minute.", 502, "upstream");
    }
    const completion = await response.json().catch(() => ({})) as Completion;
    if (!response.ok) {
      console.error("Ask USTX: the model refused the request", response.status, completion.error?.code ?? completion.error?.type ?? "");
      throw new AssistantError(response.status === 429 ? "The assistant is busy. Try again in a minute." : "The assistant is unavailable right now.", 502, "upstream");
    }
    const choice = completion.choices?.[0];
    const calls = (choice?.message?.tool_calls ?? []).filter(call => call.type === "function").slice(0, ASSISTANT_LIMITS.toolCallsPerRound);
    if (calls.length && !last) {
      messages.push({ role: "assistant", content: choice?.message?.content ?? null, tool_calls: calls });
      const results = await Promise.all(calls.map(call => runTool(tools, call)));
      calls.forEach((call, index) => {
        if (!toolsUsed.includes(call.function.name)) toolsUsed.push(call.function.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: results[index] });
      });
      continue;
    }
    const answer = choice?.message?.content?.trim();
    if (!answer) throw new AssistantError("The assistant could not finish an answer. Try a shorter question.", 502, "empty");
    return { answer, toolsUsed };
  }
  throw new AssistantError("The assistant could not finish an answer. Try a shorter question.", 502, "empty");
}
