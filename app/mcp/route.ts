import { handleMcp } from "@/lib/mcp/server";
import { ustxTools } from "./tools";

export const dynamic = "force-dynamic";

// Ganymede's MCP endpoint (lib/mcp/server.ts): AI agents read USTX on X Layer through its tools.
// Public and read-only, like the other partner APIs; nothing here signs, sends or writes.

const handle = (request: Request) => handleMcp(request, ustxTools(new URL(request.url).origin));

export const POST = handle;
export const GET = handle;
export const OPTIONS = handle;
