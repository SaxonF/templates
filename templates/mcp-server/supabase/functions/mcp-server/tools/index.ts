import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type { ToolContext } from "./types.ts";
import { registerEchoTool } from "./echo.ts";
import { registerWhoamiTool } from "./whoami.ts";

export type { ToolContext } from "./types.ts";

// =============================================================================
// Tool aggregator (the extension point)
// =============================================================================
//
// index.ts calls registerTools() once per request with the base ToolContext.
// To add tools, register them here. Tool TEMPLATES (e.g. mcp-sql) ship their
// own version of THIS file that calls the framework's example tools plus their
// own; when several tool templates are composed, the headless-app block ships
// the final aggregated version.
//
// Framework files (index.ts, auth.ts, types.ts, deno.json) are never touched by
// tool templates — only this file is.
export function registerTools(server: McpServer, context: ToolContext): void {
  registerEchoTool(server, context);
  registerWhoamiTool(server, context);
}
