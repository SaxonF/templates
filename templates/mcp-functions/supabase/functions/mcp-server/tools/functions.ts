import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type { ToolContext } from "./types.ts";

// Register app-specific typed Edge Function tools here.
//
// Keep this file as a named-tool allowlist. Do not expose a generic
// "invoke any function by string" tool; agents should only see capabilities
// with explicit schemas, descriptions, and safety annotations.
//
// Example:
//
// import { z } from "npm:zod@4.4.3";
// import { invokeEdgeFunction } from "./edge-function.ts";
//
// server.registerTool(
//   "send_invite",
//   {
//     description: "Send an organization invite email.",
//     inputSchema: {
//       organizationId: z.string().uuid(),
//       email: z.string().email(),
//     },
//     annotations: {
//       readOnlyHint: false,
//       destructiveHint: false,
//       openWorldHint: true,
//     },
//   },
//   ({ organizationId, email }) =>
//     invokeEdgeFunction(context.supabase, "send-invite", {
//       organizationId,
//       email,
//     }),
// );
export function registerFunctionTools(
  _server: McpServer,
  _context: ToolContext,
): void {
  // Intentionally empty until the app opts into named function tools.
}
