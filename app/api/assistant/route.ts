import { engineEnv, isSameSiteRequest, noStoreJson } from "@/lib/engine/api-helpers";
import { AssistantError, askUstx, parseConversation, takeQuestion } from "@/lib/assistant/ask";
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
    const result = await askUstx(conversation, ustxTools(new URL(request.url).origin), { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof AssistantError) return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
    console.error("Ask USTX failed", error instanceof Error ? error.name : "error");
    return noStoreJson({ error: "The assistant is unavailable right now.", code: "failed" }, { status: 500 });
  }
}
