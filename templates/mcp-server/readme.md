# MCP Server

A composable **Model Context Protocol** server, deployed as a single Supabase
Edge Function. This is the **framework** other templates build on: it owns the
transport, connection handling, authentication, and the tool registry — and
nothing else. Tools come from tool templates (e.g. [mcp-sql](../mcp-sql)) or
your own files.

## What it does

- **Official MCP transport.** Uses `@modelcontextprotocol/sdk` with the
  `WebStandardStreamableHTTPServerTransport` (stateless, JSON responses), so any
  spec-compliant MCP client — Claude Desktop, MCP Inspector, the AI SDK MCP
  client — can connect.
- **Dual-mode auth** ([auth.ts](supabase/functions/mcp-server/auth.ts)):
  1. **OAuth 2.1 protected resource** — for external clients. Tokens carry a
     `client_id` and must be audience-bound to this resource (the resource URL
     appears in `aud`, added by the access-token hook migration). This stops a
     token minted elsewhere from being replayed here.
  2. **First-party Supabase JWT** — for in-project callers such as the
     [agent](../agent) forwarding the user's session token. No `client_id`, no
     resource-audience binding. Set `MCP_ALLOW_FIRST_PARTY_JWT=false` to require
     OAuth only.

  Both modes build a user-scoped Supabase client and confirm the live session,
  so revoked grants and deleted sessions take effect immediately.
- **No UI.** The OAuth consent / sign-in / setup screens live in the
  [mcp-auth-ui](../mcp-auth-ui) template.

## Files

| File | Role |
| --- | --- |
| `supabase/functions/mcp-server/index.ts` | Transport + request lifecycle. Builds the base `ToolContext` and calls `registerTools`. |
| `supabase/functions/mcp-server/auth.ts` | Dual-mode auth + OAuth protected-resource metadata + CORS. |
| `supabase/functions/mcp-server/tools/types.ts` | The base `ToolContext` type. Framework-owned; never overwritten. |
| `supabase/functions/mcp-server/tools/index.ts` | The tool aggregator — **the one extension point**. |
| `supabase/functions/mcp-server/tools/{echo,whoami}.ts` | Example tools. |
| `supabase/functions/mcp-server/tools/{result,edge-function}.ts` | Shared helpers for consistent MCP results and typed Edge Function tool wrappers. |
| `supabase/migrations/…_mcp_access_token_hook.sql` | Adds the resource URL to OAuth token audiences. |
| `supabase/config.toml` | Auth (OAuth server + hook), edge runtime, function config. |

## Composition contract

This is how tool templates extend the server without colliding under shadcn's
whole-file copy:

- **Tool templates are purely additive.** They drop tool files under
  `supabase/functions/mcp-server/tools/`, add their own timestamped migrations,
  and import any shared library with a **relative path**
  (`../../_shared/<lib>/mod.ts`). They **never** edit `index.ts`, `auth.ts`,
  `types.ts`, or `deno.json`.
- **Tools get their own dependencies from module singletons**, not from the base
  `ToolContext`, so the framework never references a specific tool.
- **Generic helpers live in the framework.** Use `result.ts` for consistent MCP
  payloads and `edge-function.ts` for named, schema-validated Edge Function
  tools. Do not expose a generic "invoke any function" dispatcher.
- **`tools/index.ts` is the only contested file.** It is owned by the leaf: a
  single tool template ships its own version; when several are composed, the
  [headless-app](../headless-app) block ships the final aggregated version.

## Adding a tool

1. Create `supabase/functions/mcp-server/tools/my-tool.ts` exporting
   `registerMyTool(server, context)` and calling `server.registerTool(...)`.
2. Call it from `registerTools` in `tools/index.ts`.

```ts
// tools/my-tool.ts
import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";
import type { ToolContext } from "./types.ts";

export function registerMyTool(server: McpServer, { supabase }: ToolContext): void {
  server.registerTool(
    "my_tool",
    { description: "…", inputSchema: { name: z.string() } },
    async ({ name }) => {
      const { data, error } = await supabase.from("things").select("*").eq("name", name);
      if (error) return { isError: true, content: [{ type: "text", text: error.message }] };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MCP_SERVER_NAME` | `supabase-agent` | Display name shown in MCP clients. |
| `MCP_SERVER_DESCRIPTION` | _(generic)_ | Server description / instructions. |
| `MCP_ALLOW_FIRST_PARTY_JWT` | `true` | Accept first-party Supabase JWTs in addition to OAuth tokens. |
| `MCP_RESOURCE_URL` | _(derived)_ | Override the canonical resource URL. **Required on hosted Supabase** (Edge Functions derive internal URLs). Also use for custom domains. |
| `MCP_AUTH_ISSUER` | _(derived)_ | Override the canonical auth issuer. **Required on hosted Supabase.** Also use for custom domains. |

## Local endpoint

After `supabase start`:

```text
http://127.0.0.1:54321/functions/v1/mcp-server
```

## Dependencies

Requires a Supabase project with Edge Functions enabled. Pairs with
[mcp-auth-ui](../mcp-auth-ui) (OAuth UI), [mcp-sql](../mcp-sql) (database tool),
and Supabase-native tool packs such as [mcp-workflows](../mcp-workflows),
[mcp-storage](../mcp-storage), and [mcp-tenancy](../mcp-tenancy). The
[headless-app](../headless-app) block bundles the common stack.
