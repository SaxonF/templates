import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";

import type { ToolContext } from "./types.ts";

// A minimal user-scoped tool: it returns identity straight from the verified
// token claims, demonstrating that every tool runs as the signed-in user
// without needing database access.
export function registerWhoamiTool(
  server: McpServer,
  { principal }: ToolContext,
): void {
  server.registerTool(
    "whoami",
    {
      description:
        "Return the signed-in user's id and basic token claims (sub, email, role).",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    () => {
      const claims = principal.claims;
      const identity = {
        sub: claims.sub ?? null,
        email: claims.email ?? null,
        role: claims.role ?? null,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(identity) }],
      };
    },
  );
}
