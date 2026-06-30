import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type { ToolContext } from "./types.ts";
import { registerEchoTool } from "./echo.ts";
import { registerWhoamiTool } from "./whoami.ts";
import { registerEmailTools } from "./email.ts";

export type { ToolContext } from "./types.ts";

// Standalone aggregator for mcp-server + mcp-email.
//
// When composing several tool templates, the headless-app block ships the final
// aggregated version of this file.
export function registerTools(server: McpServer, context: ToolContext): void {
  registerEchoTool(server, context);
  registerWhoamiTool(server, context);
  registerEmailTools(server, context);
}
