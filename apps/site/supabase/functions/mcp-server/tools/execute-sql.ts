import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { SqlToolContext } from "./index.ts";
import { jsonResult, runtimeErrorResult } from "./result.ts";

export function registerExecuteSqlTool(
  server: McpServer,
  { sql, principal }: SqlToolContext,
): void {
  server.registerTool(
    "execute_sql",
    {
      description:
        "Run one INSERT, UPDATE, DELETE, or MERGE statement against Postgres as the signed-in user. " +
        "Grants and Row Level Security apply. Use RETURNING selectively to inspect affected rows. " +
        "Use a single CTE for atomic data-local workflows and typed tools for external effects.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(65_536)
          .describe(
            "One PostgreSQL INSERT, UPDATE, DELETE, or MERGE statement.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }: { query: string }) => {
      try {
        return jsonResult(await sql.mutate(principal, query));
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
