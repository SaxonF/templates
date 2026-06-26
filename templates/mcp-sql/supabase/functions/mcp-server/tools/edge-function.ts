import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import type { CallToolResult } from "npm:@modelcontextprotocol/sdk@1.29.0/types.js";

import { errorResult, jsonResult } from "./result.ts";

// Helper for building tools that are a typed front door to a Supabase Edge
// Function. It invokes the function as the signed-in user and returns a ready
// MCP tool result, so the tool handler can be a one-liner:
//
//   server.registerTool('send_invite',
//     { description: 'Invite a user by email.', inputSchema: { email: z.string().email() } },
//     ({ email }) => invokeEdgeFunction(supabase, 'send-invite', { email }))
//
// The user's access token is forwarded automatically (via the user-scoped
// client); no caller-controlled headers are sent. The TARGET function is still
// responsible for its own authentication/authorization — see README →
// "Calling Edge Functions from a tool".
//
// If you need to transform or combine the response, call
// `supabase.functions.invoke(...)` directly and wrap the result yourself with
// the helpers in ./result.ts.
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
