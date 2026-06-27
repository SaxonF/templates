import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.29.0/types.js";

import { errorResult, jsonResult } from "./result.ts";

// Helper for building tools that are a typed front door to a Supabase Edge
// Function. It invokes the function as the signed-in user and returns a ready
// MCP tool result, so the tool handler can stay small:
//
//   server.registerTool("send_invite",
//     { description: "Invite a user by email.", inputSchema: { email: z.string().email() } },
//     ({ email }) => invokeEdgeFunction(supabase, "send-invite", { email }))
//
// The user's access token is forwarded automatically by the user-scoped
// Supabase client. The target function is still responsible for its own
// authentication and authorization.
export async function invokeEdgeFunction(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    return errorResult(error.message);
  }

  return jsonResult(data ?? null);
}
