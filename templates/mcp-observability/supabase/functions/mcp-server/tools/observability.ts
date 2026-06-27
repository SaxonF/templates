import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { errorResult, jsonResult, runtimeErrorResult } from "./result.ts";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export function registerObservabilityTools(
  server: McpServer,
  { supabase }: ToolContext,
): void {
  server.registerTool(
    "write_app_log",
    {
      description:
        "Write a structured application log event owned by the signed-in user.",
      inputSchema: {
        level: logLevelSchema.default("info"),
        message: z.string().min(1).max(2_000),
        metadata: z.record(z.string(), z.unknown()).default({}),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (
      input: { level: string; message: string; metadata: Record<string, unknown> },
    ) => {
      try {
        const { data, error } = await supabase
          .from("app_logs")
          .insert({
            level: input.level,
            message: input.message,
            metadata: input.metadata,
          })
          .select("id, level, message, metadata, created_at")
          .single();
        if (error) return errorResult(error.message);
        return jsonResult(data);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_app_logs",
    {
      description:
        "List recent structured application log events owned by the signed-in user.",
      inputSchema: {
        level: logLevelSchema.optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { level?: string; limit: number }) => {
      try {
        let query = supabase
          .from("app_logs")
          .select("id, level, message, metadata, created_at")
          .order("created_at", { ascending: false })
          .limit(input.limit);

        if (input.level) query = query.eq("level", input.level);

        const { data, error } = await query;
        if (error) return errorResult(error.message);
        return jsonResult({ logs: data ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_failed_workflows",
    {
      description:
        "List recent failed or dead-letter workflow runs owned by the signed-in user.",
      inputSchema: {
        workflowType: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { workflowType?: string; limit: number }) => {
      try {
        let query = supabase
          .from("workflow_runs")
          .select(
            "id, workflow_type, status, attempt_count, max_attempts, error, metadata, created_at, updated_at",
          )
          .in("status", ["failed", "dead_letter"])
          .order("updated_at", { ascending: false })
          .limit(input.limit);

        if (input.workflowType) {
          query = query.eq("workflow_type", input.workflowType);
        }

        const { data, error } = await query;
        if (error) return errorResult(error.message);
        return jsonResult({ runs: data ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
