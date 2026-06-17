# MCP server template

Scaffolds a Model Context Protocol server as a Supabase Edge Function. The function speaks JSON-RPC over HTTP and exposes tools that are declared through a small registry.

This composes with the **Agent** template: `agent-chat` can connect to this Edge Function and expose its tools to the model. By default, the agent looks for a local MCP server at `${SUPABASE_URL}/functions/v1/mcp-server`; you can also register additional servers in `public.agent_mcp_servers`.

## Includes

- `supabase/functions/mcp-server/index.ts` — JSON-RPC entrypoint handling `initialize`, `tools/list`, and `tools/call`
- `supabase/functions/mcp-server/registry.ts` — `registerTool` API and tool typings
- `supabase/functions/mcp-server/user-client.ts` — service-role and user-scoped Supabase clients
- `supabase/functions/mcp-server/tools/` — one file per tool, imported from `tools/index.ts`

## User-scoped tools (RLS)

`ToolContext` provides two clients:

| Client | Use |
| ------ | --- |
| `supabase` | Service role — bypasses RLS. Use for schema introspection (`list_tables`) or admin-only operations. |
| `userSupabase` | Created from the request `Authorization` header. Use for queries against RLS-protected tables. |

`agent-chat` forwards the user's JWT when calling this server. Tools that read or write tenant data should use `userSupabase` and return a clear error when it is missing:

```ts
async handler(args, { userSupabase }) {
  if (!userSupabase) {
    throw new Error('Authorization header with user JWT is required')
  }

  const { data, error } = await userSupabase.from('notes').select('*')
  if (error) throw new Error(error.message)
  return data
}
```

## Adding a tool

1. Create a new file under `supabase/functions/mcp-server/tools/`, e.g. `tools/my-tool.ts`.
2. Call `registerTool({ name, description, inputSchema, handler })` at module scope.
3. Import the new file from `tools/index.ts` so it self-registers at boot.

## Local endpoint

After `supabase start`, the MCP server is available at:

```text
http://127.0.0.1:<api-port>/functions/v1/mcp-server
```

Run `supabase status` for the API port and Mailpit URL for your project.

## Dependencies

Requires **database**, **api**, and **functions**.
