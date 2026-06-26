import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/server/webStandardStreamableHttp.js";

import {
  applyCors,
  authenticateRequest,
  getAuthConfig,
  isProtectedResourceMetadataRequest,
  optionsResponse,
  protectedResourceMetadataResponse,
} from "./auth.ts";
import { registerTools } from "./tools/index.ts";

// =============================================================================
// MCP server framework (Supabase Edge Function)
// =============================================================================
//
// This is the reusable transport + auth + tool-registry shell. It exposes the
// signed-in Supabase user's tools over the official MCP Streamable HTTP
// transport. It deliberately knows NOTHING about specific tools — tool
// templates (e.g. mcp-sql) add files under ./tools/ and extend ./tools/index.ts.
//
// See readme.md → "Composition contract".

function readTextEnv(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

const SERVER_NAME = readTextEnv("MCP_SERVER_NAME", "supabase-agent");
const SERVER_DESCRIPTION = readTextEnv(
  "MCP_SERVER_DESCRIPTION",
  "MCP access to this Supabase project for the signed-in user.",
);

const SERVER_INFO = {
  name: SERVER_NAME,
  version: "1.0.0",
};

const SERVER_INSTRUCTIONS =
  `${SERVER_DESCRIPTION} ` +
  "Every tool runs as the signed-in Supabase user; role grants and Row Level Security apply. " +
  "Call tools/list to discover the tools this project exposes, and read a tool's description " +
  "and annotations before calling it — some tools may have side effects.";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  const auth = getAuthConfig(request);

  if (isProtectedResourceMetadataRequest(request)) {
    return protectedResourceMetadataResponse(auth);
  }

  const authentication = await authenticateRequest(request, auth);
  if (!authentication.ok) {
    return applyCors(authentication.response);
  }

  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

  registerTools(server, {
    supabase: authentication.context.supabase,
    principal: { claims: authentication.context.claims },
    request,
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
