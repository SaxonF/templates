import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";

export function registerEchoTool(
  server: McpServer,
  _context: ToolContext,
): void {
  server.registerTool(
    "echo",
    {
      description:
        "Echo the provided message back. Useful for connectivity checks.",
      inputSchema: {
        message: z.string().describe("Text to echo back."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    ({ message }: { message: string }) => ({
      content: [{ type: "text", text: message }],
    }),
  );
}
