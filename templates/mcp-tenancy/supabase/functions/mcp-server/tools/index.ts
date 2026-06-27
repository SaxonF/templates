import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type { ToolContext } from "./types.ts";
import { registerEchoTool } from "./echo.ts";
import { registerTenancyTools } from "./tenancy.ts";
import { registerWhoamiTool } from "./whoami.ts";

export type { ToolContext } from "./types.ts";

// Standalone aggregator for mcp-server + mcp-tenancy.
export function registerTools(server: McpServer, context: ToolContext): void {
  registerEchoTool(server, context);
  registerWhoamiTool(server, context);
  registerTenancyTools(server, context);
}
