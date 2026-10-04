import { engineEnv, isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { AssistantError, askUstx, parseConversation, streamUstx, takeQuestion, type AskEvent } from "@/lib/assistant/ask";
import { ustxTools } from "../../mcp/tools";

export const dynamic = "force-dynamic";

/**
 * Ask USTX: answers a visitor's question from the read-only USTX tools. Same-site only, so other
 * sites cannot spend the site's model allowance; each question counts against a daily allowance.
 */
export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return noStoreJson({ error: "Same-origin request required" }, { status: 403 });
  try {
    const env = engineEnv();
    if (!env.OPENAI_API_KEY) throw new AssistantError("The assistant is not available on this deployment.", 503, "not_configured");
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) throw new AssistantError("Send a JSON object with Content-Type: application/json.", 400, "bad_request");
    const text = await request.text();
    if (text.length > 16_000) throw new AssistantError("This conversation is too long. Start a new one.", 400, "too_long");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AssistantError("Send a JSON object with Content-Type: application/json.", 400, "bad_request"); }
    const conversation = parseConversation(body);
    const visitor = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await takeQuestion(env.DB, visitor, new Date());
    const tools = ustxTools(new URL(request.url).origin);
    const options = { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL };
    if (!(request.headers.get("accept") ?? "").includes("application/x-ndjson")) return noStoreJson(await askUstx(conversation, tools, options));
    // Streamed: one JSON event per line as the answer is read and written. The first event is awaited
    // here, so a model that cannot be reached still answers with its status code.
    const events = streamUstx(conversation, tools, options);
    const first = await events.next();
    const encoder = new TextEncoder();
    const line = (event: AskEvent | { type: "error"; message: string }) => encoder.encode(`${JSON.stringify(event)}\n`);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (!first.done) controller.enqueue(line(first.value));
        try {
          for await (const event of events) controller.enqueue(line(event));
        } catch (error) {
          if (!(error instanceof AssistantError)) console.error("Ask USTX failed", error instanceof Error ? error.name : "error");
          controller.enqueue(line({ type: "error", message: error instanceof AssistantError ? error.message : "The assistant is unavailable right now." }));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof AssistantError) return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
    console.error("Ask USTX failed", error instanceof Error ? error.name : "error");
    return noStoreJson({ error: "The assistant is unavailable right now.", code: "failed" }, { status: 500 });
  }
}
