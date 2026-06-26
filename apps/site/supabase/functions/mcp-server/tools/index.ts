import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

import type {
  AgentSqlRuntime,
  SupabasePrincipal,
} from "@agent-sql";
import {
  registerDescribeFunctionTool,
  registerDescribeTableTool,
  registerListDatabaseObjectsTool,
} from "./catalog.ts";
import { registerExecuteSqlTool } from "./execute-sql.ts";
import { registerQuerySqlTool } from "./query-sql.ts";

export type ToolContext = {
  supabase: SupabaseClient;
  sql: AgentSqlRuntime<SupabasePrincipal>;
  principal: SupabasePrincipal;
};

// Add project-specific typed tools here. For external effects, expose one MCP
// tool per Edge Function and invoke it through ./edge-function.ts. Do not expose
// a generic function dispatcher or a raw database client.
export function registerTools(server: McpServer, context: ToolContext): void {
  registerQuerySqlTool(server, context);
  registerExecuteSqlTool(server, context);
  registerListDatabaseObjectsTool(server, context);
  registerDescribeTableTool(server, context);
  registerDescribeFunctionTool(server, context);
}
