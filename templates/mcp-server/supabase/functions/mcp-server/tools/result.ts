import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.29.0/types.js";

// Shared helpers for building MCP tool results.
//
// Every tool returns the same `{ content: [...] }` shape, and signals failure
// with `isError: true`. Centralising that here keeps each tool focused on its
// own logic and makes the wire format consistent.

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
 * and retry. Keep it actionable without exposing credentials, claims, or stacks.
 */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error ? error.code : null;
  return typeof code === "string" && code ? code : null;
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = "postgresCode" in error ? error.postgresCode : null;
  return typeof code === "string" && code ? code : null;
}

/** Convert an unknown runtime error into a safe MCP tool error. */
export function runtimeErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  const postgres = postgresCode(error);

  if (code) {
    return errorResult(
      `[${code}] ${message}${postgres ? ` (PostgreSQL ${postgres})` : ""}`,
    );
  }

  return errorResult(message);
}
