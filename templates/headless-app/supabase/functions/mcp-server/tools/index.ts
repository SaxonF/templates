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

// App-owned typed Edge Function tool scaffold.
import { registerFunctionTools } from "./functions.ts";

// Email tools from the mcp-email template.
import { registerEmailTools } from "./email.ts";

// SQL tools from the mcp-sql template.
import {
  registerDescribeFunctionTool,
  registerDescribeTableTool,
  registerListDatabaseObjectsTool,
} from "./catalog.ts";
import { registerExecuteSqlTool } from "./execute-sql.ts";
import { registerKnowledgeTools } from "./knowledge.ts";
import { registerObservabilityTools } from "./observability.ts";
import { registerQuerySqlTool } from "./query-sql.ts";
import { registerStorageTools } from "./storage.ts";
import { registerTenancyTools } from "./tenancy.ts";
import { registerWorkflowTools } from "./workflows.ts";

export type { ToolContext } from "./types.ts";

export type SqlToolContext = {
  sql: AgentSqlRuntime<SupabasePrincipal>;
  principal: SupabasePrincipal;
};

// =============================================================================
// headless-app tool aggregator (the composition resolver)
// =============================================================================
//
// This is the block-owned aggregator. Because the block depends on mcp-server
// and mcp-sql, those file installs land first and this file overwrites the
// per-template aggregators. EDIT THIS FILE when you add another tool template:
// import its register* functions and call them below.
export function registerTools(server: McpServer, context: ToolContext): void {
  // Framework example tools.
  registerEchoTool(server, context);
  registerWhoamiTool(server, context);

  // Supabase-native composable tools.
  registerFunctionTools(server, context);
  registerWorkflowTools(server, context);
  registerStorageTools(server, context);
  registerTenancyTools(server, context);
  registerKnowledgeTools(server, context);
  registerObservabilityTools(server, context);
  registerEmailTools(server, context);

  // SQL tools (mcp-sql). The runtime is a module singleton; the principal is
  // the verified claims from the base context.
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
