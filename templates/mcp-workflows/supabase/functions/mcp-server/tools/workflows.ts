import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { errorResult, jsonResult, runtimeErrorResult } from "./result.ts";

const workflowStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dead_letter",
]);

export function registerWorkflowTools(
  server: McpServer,
  { supabase }: ToolContext,
): void {
  server.registerTool(
    "enqueue_workflow",
    {
      description:
        "Create and enqueue a durable workflow run owned by the signed-in user.",
      inputSchema: {
        workflowType: z.string().min(1),
        input: z.record(z.string(), z.unknown()).default({}),
        runAfter: z.string().datetime().optional(),
        maxAttempts: z.number().int().min(1).max(20).default(3),
        metadata: z.record(z.string(), z.unknown()).default({}),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (
      input: {
        workflowType: string;
        input: Record<string, unknown>;
        runAfter?: string;
        maxAttempts: number;
        metadata: Record<string, unknown>;
      },
    ) => {
      try {
        const { data, error } = await supabase.rpc("enqueue_workflow", {
          workflow_type: input.workflowType,
          input: input.input,
          run_after: input.runAfter ?? new Date().toISOString(),
          max_attempts: input.maxAttempts,
          metadata: input.metadata,
        });
        if (error) return errorResult(error.message);
        return jsonResult({ runId: data });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_workflow_run",
    {
      description:
        "Read one user-owned workflow run, including steps and attempts.",
      inputSchema: {
        runId: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { runId: string }) => {
      try {
        const { data: run, error: runError } = await supabase
          .from("workflow_runs")
          .select("*")
          .eq("id", input.runId)
          .single();
        if (runError) return errorResult(runError.message);

        const [{ data: steps, error: stepsError }, {
          data: attempts,
          error: attemptsError,
        }] = await Promise.all([
          supabase
            .from("workflow_steps")
            .select("*")
            .eq("run_id", input.runId)
            .order("created_at", { ascending: true }),
          supabase
            .from("workflow_attempts")
            .select("*")
            .eq("run_id", input.runId)
            .order("started_at", { ascending: true }),
        ]);
        if (stepsError) return errorResult(stepsError.message);
        if (attemptsError) return errorResult(attemptsError.message);

        return jsonResult({ run, steps: steps ?? [], attempts: attempts ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_workflow_runs",
    {
      description: "List recent workflow runs owned by the signed-in user.",
      inputSchema: {
        status: workflowStatusSchema.optional(),
        workflowType: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (
      input: { status?: string; workflowType?: string; limit: number },
    ) => {
      try {
        let query = supabase
          .from("workflow_runs")
          .select(
            "id, workflow_type, status, attempt_count, max_attempts, run_after, result, error, metadata, created_at, updated_at",
          )
          .order("created_at", { ascending: false })
          .limit(input.limit);

        if (input.status) query = query.eq("status", input.status);
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

  server.registerTool(
    "cancel_workflow",
    {
      description:
        "Cancel a queued, running, or failed user-owned workflow run.",
      inputSchema: {
        runId: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input: { runId: string }) => {
      try {
        const { data, error } = await supabase.rpc("cancel_workflow", {
          target_run_id: input.runId,
        });
        if (error) return errorResult(error.message);
        return jsonResult(data);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "retry_workflow",
    {
      description:
        "Requeue a failed, dead-lettered, or cancelled user-owned workflow run.",
      inputSchema: {
        runId: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { runId: string }) => {
      try {
        const { data, error } = await supabase.rpc("retry_workflow", {
          target_run_id: input.runId,
        });
        if (error) return errorResult(error.message);
        return jsonResult(data);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
