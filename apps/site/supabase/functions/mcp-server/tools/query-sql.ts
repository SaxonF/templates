import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { SqlToolContext } from "./index.ts";
import { jsonResult, runtimeErrorResult } from "./result.ts";

export function registerQuerySqlTool(
  server: McpServer,
  { sql, principal }: SqlToolContext,
): void {
  server.registerTool(
    "query_sql",
    {
      description:
        "Run one read-only SELECT against Postgres as the signed-in user. Grants and Row Level " +
        "Security apply. CTEs, joins, aggregates, and subqueries are supported; writes, DDL, " +
        "procedural commands, SELECT INTO, and row-locking clauses are rejected. Results are capped.",
      inputSchema: {
        query: z.string().min(1).max(65_536).describe(
          "One PostgreSQL SELECT statement.",
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query }: { query: string }) => {
      try {
        return jsonResult(await sql.query(principal, query));
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
