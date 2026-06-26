import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type {
  AgentSqlRuntime,
  SupabasePrincipal,
} from "../../_shared/agent-sql/mod.ts";
import type { ToolContext } from "./types.ts";
import { getSqlRuntime } from "../sql-runtime.ts";

// Example tools shipped by the mcp-server framework.
import { registerEchoTool } from "./echo.ts";
import { registerWhoamiTool } from "./whoami.ts";

// SQL tools from this template.
import {
  registerDescribeFunctionTool,
  registerDescribeTableTool,
  registerListDatabaseObjectsTool,
} from "./catalog.ts";
import { registerExecuteSqlTool } from "./execute-sql.ts";
import { registerQuerySqlTool } from "./query-sql.ts";

export type { ToolContext } from "./types.ts";

// Context for the SQL tools. The runtime is a module singleton, not part of the
// base ToolContext (see ../sql-runtime.ts and the framework's composition
// contract).
export type SqlToolContext = {
  sql: AgentSqlRuntime<SupabasePrincipal>;
  principal: SupabasePrincipal;
};

// =============================================================================
// Tool aggregator (standalone: mcp-server + mcp-sql)
// =============================================================================
//
// This is the leaf-owned aggregator used when installing mcp-sql directly on top
// of mcp-server. When composing several tool templates, the headless-app block
// ships the final aggregated version of this file. To add an external effect,
// expose one MCP tool per Edge Function via ./edge-function.ts — do not expose a
// generic function dispatcher or a raw database client.
export function registerTools(server: McpServer, context: ToolContext): void {
  // Framework example tools.
  registerEchoTool(server, context);
  registerWhoamiTool(server, context);

  // SQL tools — the runtime comes from the singleton; the principal is the
  // verified claims from the base context.
  const sqlContext: SqlToolContext = {
    sql: getSqlRuntime(),
    principal: context.principal as SupabasePrincipal,
  };
  registerQuerySqlTool(server, sqlContext);
  registerExecuteSqlTool(server, sqlContext);
  registerListDatabaseObjectsTool(server, sqlContext);
  registerDescribeTableTool(server, sqlContext);
  registerDescribeFunctionTool(server, sqlContext);
}
