import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { SqlToolContext } from "./index.ts";
import { errorResult, jsonResult, runtimeErrorResult } from "./result.ts";

export function registerListDatabaseObjectsTool(
  server: McpServer,
  { sql, principal }: SqlToolContext,
): void {
  server.registerTool(
    "list_database_objects",
    {
      description:
        "List tables, views, and callable functions available to the signed-in user. " +
        "Results are privilege-filtered and paginated; use the returned nextCursor to continue.",
      inputSchema: {
        schema: z.string().min(1).optional().describe(
          "Optional schema filter.",
        ),
        kind: z.enum(["relation", "function"]).optional().describe(
          "Optional object-kind filter.",
        ),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional().describe(
          "Opaque cursor from a previous result.",
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: {
      schema?: string;
      kind?: "relation" | "function";
      limit: number;
      cursor?: string;
    }) => {
      try {
        return jsonResult(await sql.listDatabaseObjects(principal, input));
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}

export function registerDescribeTableTool(
  server: McpServer,
  { sql, principal }: SqlToolContext,
): void {
  server.registerTool(
    "describe_table",
    {
      description:
        "Describe an accessible table or view: columns, defaults, comments, primary key, " +
        "foreign keys, kind, and whether Row Level Security is enabled.",
      inputSchema: {
        table: z.string().min(1).describe("Table or view name."),
        schema: z.string().min(1).default("public").describe("Schema name."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ table, schema }: { table: string; schema: string }) => {
      try {
        const definition = await sql.describeTable(principal, {
          table,
          schema,
        });
        if (!definition) {
          return errorResult(
            `No accessible table named "${schema}.${table}" was found.`,
          );
        }
        return jsonResult(definition);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}

export function registerDescribeFunctionTool(
  server: McpServer,
  { sql, principal }: SqlToolContext,
): void {
  server.registerTool(
    "describe_function",
    {
      description:
        "Describe every accessible overload of a database function, including arguments, " +
        "return type, volatility, language, comments, and invoker/definer security.",
      inputSchema: {
        name: z.string().min(1).describe("Function name."),
        schema: z.string().min(1).default("public").describe("Schema name."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, schema }: { name: string; schema: string }) => {
      try {
        const definitions = await sql.describeFunction(principal, {
          name,
          schema,
        });
        if (definitions.length === 0) {
          return errorResult(
            `No accessible function named "${schema}.${name}" was found.`,
          );
        }
        return jsonResult(definitions);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
