# Agent template

Build persistent AI agents on Supabase with a streaming chat endpoint, session history, long-term memory, and MCP tool access. The generated `agent-chat` Edge Function uses **AI SDK 7** to stream model responses back to clients while persisting user and assistant messages in Postgres.

The agent is **standalone** — it connects to whatever MCP servers are deployed and uses the AI SDK's built-in MCP client (`@ai-sdk/mcp`) over Streamable HTTP. Add the **mcp-server** framework (plus tool templates like **mcp-sql**) and the agent automatically discovers and uses their tools; no client-side MCP wiring required.

## What's included

| Asset         | Path                                              | Purpose                                              |
| ------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Schema        | `supabase/schemas/public/tables/agent_*.sql`      | `agent_sessions`, `agent_memories`, `agent_mcp_servers` (+ RLS, grants) |
| Edge Function | `supabase/functions/agent-chat/index.ts`          | Streaming AI SDK chat endpoint                       |

The schema follows the pg-delta declarative layout — one file per table under `schemas/public/tables/`, each carrying its own RLS policies and grants.

### Sessions and messages

Each session belongs to a user. `agent-chat` creates a session when `sessionId` is omitted, appends the user message, streams the model response, then persists the assistant response. The function verifies the caller's JWT, then writes sessions and messages with the service role — the `service_role` grants in `agent_sessions.sql` and `agent_memories.sql` let those inserts succeed.

### Memory and recall

Memory rows can store arbitrary JSON payloads. The base agent schema intentionally omits pgvector objects so `supabase db diff` works reliably on fresh projects.

### MCP tools

`agent-chat` connects to each MCP server with the AI SDK MCP client (`createMCPClient` over Streamable HTTP), calls `client.tools()`, and passes the merged tool set to the model. Clients are closed when the stream finishes. The caller's JWT is forwarded in the `Authorization` header, which the **mcp-server** framework accepts via its first-party auth path.

**Default behavior**

`agent-chat` automatically connects to this project's `mcp-server` Edge Function at `${SUPABASE_URL}/functions/v1/mcp-server` and forwards the caller's JWT. You do not need to pass `mcpServers` from the browser for that.

**Minimal client example**

```ts
const response = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sessionId,
    message: 'List my notes',
  }),
})
```

**Configuring MCP servers (persistent)**

```sql
insert into public.agent_mcp_servers (name, url)
values
  ('project', '/functions/v1/mcp-server'),  -- relative path; resolved server-side
  ('external', 'https://api.example.com/mcp'); -- external host; used as-is
```

**Request-scoped overrides** — only for additional servers or explicit header overrides:

```ts
mcpServers: [{ name: 'external', url: 'https://api.example.com/mcp' }]
```

| URL shape | Resolved to |
| --------- | ----------- |
| `/functions/v1/mcp-server` | `${SUPABASE_URL}/functions/v1/mcp-server` |
| `https://<ref>.supabase.co/functions/v1/mcp-server` | `${SUPABASE_URL}/functions/v1/mcp-server` |
| `https://other-host/...` | unchanged |

Tool names are namespaced as `<server>_<tool>` (e.g. `project_list_notes`). Mention this in app system prompts if you customize behavior.

## Dependencies

**Optional**

- `mcp-server` — Edge Function MCP server the agent connects to automatically when installed; no client-side MCP configuration required

## Getting started

1. Start from a Supabase project with Auth and Edge Functions enabled (`supabase init` / `supabase start`).
2. Generate an initial migration before seeding (`supabase db diff -f initial_schema`, then `supabase db reset`).
3. Configure model provider secrets:
   - **Local:** copy `supabase/functions/.env.example` to `supabase/functions/.env` (auto-loaded by `supabase start`). Restart with `supabase stop && supabase start` after changes.
   - **Hosted:** `supabase secrets set OPENAI_API_KEY=...` and optionally `OPENAI_MODEL=gpt-4o-mini`.
4. Deploy Edge Functions: `supabase functions deploy agent-chat`.
5. From your app, POST `{ message, sessionId? }` to `agent-chat` and read the streamed text response.

For production, review the RLS policies in the `agent_*` table files, restrict service-role usage to server-side agent loops, and avoid storing long-lived third-party MCP secrets directly in `agent_mcp_servers.headers`.

## MCP tool schemas

The AI SDK MCP client (`@ai-sdk/mcp`) discovers each server's tools and converts their JSON Schemas into model-ready tools automatically — no manual `jsonSchema()` wrapper needed. `agent-chat` only namespaces the tool keys as `<server>_<tool>` so multiple servers can't collide.

## Debugging

- Run `supabase functions serve agent-chat --no-verify-jwt` and watch the terminal for MCP load errors and model failures.
- `agent-chat` streams error text to the client on model or tool failures instead of returning an empty 200 response.
- If the model invents tool names, MCP discovery likely failed — check Edge Function logs for `failed to load MCP tools` or `no MCP tools loaded`.
- Do not pass browser/public Supabase URLs into `mcpServers`; `agent-chat` resolves same-project function URLs via `SUPABASE_URL` itself.
- User-scoped MCP tools require the caller JWT; `agent-chat` forwards `Authorization` automatically.
