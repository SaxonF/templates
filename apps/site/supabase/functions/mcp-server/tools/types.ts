import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

// The base context every tool receives. It is intentionally minimal and
// tool-agnostic so the framework never has to know about specific tools.
//
// Tool templates that need extra dependencies (a SQL runtime, an external
// client, …) obtain them from their OWN module singletons rather than widening
// this type — see mcp-sql's sql-runtime.ts / tools/index.ts for the pattern.
//
// This file is owned by the framework and is never overwritten by tool
// templates. Only ./index.ts (the aggregator) is.

export type ToolPrincipal = {
  /** Verified JWT claims for the signed-in user (sub, role, email, …). */
  claims: Record<string, unknown>;
};

export type ToolContext = {
  /** User-scoped Supabase client; the caller's bearer token is attached. */
  supabase: SupabaseClient;
  /** The signed-in user's verified token claims. */
  principal: ToolPrincipal;
  /** The raw inbound request, for tools that need headers or the URL. */
  request: Request;
};
