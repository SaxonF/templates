import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.29.0/types.js";
import { AgentSqlError } from "@agent-sql";

// Shared helpers for building MCP tool results.
//
// Every tool returns the same `{ content: [...] }` shape, and signals failure
// with `isError: true`. Centralising that here keeps each tool focused on its
// own logic and makes the wire format consistent. New tools should return their
// payloads through these two helpers.

/**
 * A successful tool result. `value` is JSON-serialised into a single text block,
 * which is the format MCP clients and LLMs parse most reliably.
 */
export function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

/**
 * A failed tool result. The message is returned to the model so it can adjust
 * and retry — keep it actionable (e.g. a Postgres error string is ideal).
 */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** Convert a runtime/database error without exposing credentials, claims, or stacks. */
export function runtimeErrorResult(error: unknown): CallToolResult {
  if (error instanceof AgentSqlError) {
    const postgres = error.postgresCode
      ? ` (PostgreSQL ${error.postgresCode})`
      : "";
    return errorResult(`[${error.code}] ${error.message}${postgres}`);
  }
  return errorResult(error instanceof Error ? error.message : String(error));
}
