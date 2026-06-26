import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/server/webStandardStreamableHttp.js";

import {
  applyCors,
  authenticateRequest,
  getOAuthConfig,
  isProtectedResourceMetadataRequest,
  optionsResponse,
  protectedResourceMetadataResponse,
} from "./oauth.ts";
import { getSqlRuntime } from "./sql-runtime.ts";
import { registerTools } from "./tools/index.ts";

function readTextEnv(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

const SERVER_NAME = readTextEnv("MCP_SERVER_NAME", "supabase-agent");
const SERVER_DESCRIPTION = readTextEnv(
  "MCP_SERVER_DESCRIPTION",
  "MCP access to this Supabase database for the signed-in user.",
);

const SERVER_INFO = {
  name: SERVER_NAME,
  version: "1.0.0",
};

const SERVER_INSTRUCTIONS =
  `${SERVER_DESCRIPTION} ` +
  "All access is scoped to the signed-in Supabase user and enforced by role grants and Row Level Security. " +
  "Use list_database_objects and the describe tools to inspect the available schema. " +
  "Use query_sql for one read-only SELECT and execute_sql for one INSERT, UPDATE, DELETE, or MERGE; " +
  "the user's grants and RLS policies apply to both. Writes should use RETURNING selectively. " +
  "This project may define additional tools; some may have side effects, so inspect a tool before calling it.";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  const oauth = getOAuthConfig(request);

  if (isProtectedResourceMetadataRequest(request)) {
    return protectedResourceMetadataResponse(oauth);
  }

  const authentication = await authenticateRequest(request, oauth);
  if (!authentication.ok) {
    return applyCors(authentication.response);
  }

  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

  registerTools(server, {
    supabase: authentication.context.supabase,
    sql: getSqlRuntime(),
    principal: { claims: authentication.context.claims },
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return applyCors(await transport.handleRequest(request));
  } catch (error) {
    console.error("MCP request failed", error);
    return applyCors(
      Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Internal server error" },
        },
        { status: 500 },
      ),
    );
  }
});
