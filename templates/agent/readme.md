# Agent template

Build persistent AI agents on Supabase with a streaming chat endpoint, session history, long-term memory, and MCP tool access. The generated `agent-chat` Edge Function uses the AI SDK to stream model responses back to clients while persisting user and assistant messages in Postgres.

The agent can call tools from connected MCP servers. If you also add the **mcp-server** template, the agent can use that local Edge Function MCP server as one of its tool sources.

## What's included

| Asset         | Path                                      | Purpose                                      |
| ------------- | ----------------------------------------- | -------------------------------------------- |
| Schema        | `supabase/schemas/agent.sql`              | Sessions, messages, memory, MCP servers, RLS |
| Edge Function | `supabase/functions/agent-chat/index.ts`  | Streaming AI SDK chat endpoint               |

### Sessions and messages

Each session belongs to a user. `agent-chat` creates a session when `sessionId` is omitted, appends the user message, streams the model response, then persists the assistant response. The function verifies the caller's JWT, then writes sessions and messages with the service role — grant `service_role` table access in `agent.sql` so those inserts succeed.

### Memory and recall

Memory rows can store arbitrary JSON payloads. Add the **ai-vector-search** or **ai-automatic-embeddings** template for embedding columns, HNSW indexes, and similarity search helpers. The base agent schema intentionally omits pgvector objects so `supabase db diff` works reliably on fresh projects.

### MCP tools

`agent-chat` discovers tools from MCP servers and exposes them to the AI SDK model call.

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

**Required**

- `database` — base Supabase project config
- `api` — REST/GraphQL surface for client access
- `auth` — user-scoped sessions and RLS
- `functions` — Edge Functions runtime

**Optional**

- `ai-vector-search` — pgvector similarity over memory embeddings
- `ai-automatic-embeddings` — keep embeddings in sync via triggers
- `mcp-server` — Edge Function MCP server the agent connects to automatically when installed; no client-side MCP configuration required

## Getting started

1. Add this template (and its required dependencies) to your composition.
2. Generate an initial migration before seeding — see the **database** template readme (`supabase db diff -f initial_schema`, then `supabase db reset`).
3. Configure model provider secrets:
   - **Local:** copy `supabase/functions/.env.example` to `supabase/functions/.env` (auto-loaded by `supabase start`). Restart with `supabase stop && supabase start` after changes.
   - **Hosted:** `supabase secrets set OPENAI_API_KEY=...` and optionally `OPENAI_MODEL=gpt-4o-mini`.
4. Deploy Edge Functions: `supabase functions deploy agent-chat`.
5. From your app, POST `{ message, sessionId? }` to `agent-chat` and read the streamed text response.

For production, review RLS policies in `agent.sql`, restrict service-role usage to server-side agent loops, and avoid storing long-lived third-party MCP secrets directly in `agent_mcp_servers.headers`.

## MCP tool schemas

MCP tools expose JSON Schema. The AI SDK expects Zod or a `jsonSchema()` wrapper — `agent-chat` wraps MCP `inputSchema` values automatically with `strict: false`. If you fork the function, keep that wrapper or tool calls will fail with `schema is not a function`.

## Debugging

- Run `supabase functions serve agent-chat --no-verify-jwt` and watch the terminal for MCP load errors and model failures.
- `agent-chat` streams error text to the client on model or tool failures instead of returning an empty 200 response.
- If the model invents tool names, MCP discovery likely failed — check Edge Function logs for `failed to load MCP tools` or `no MCP tools loaded`.
- Do not pass browser/public Supabase URLs into `mcpServers`; `agent-chat` resolves same-project function URLs via `SUPABASE_URL` itself.
- User-scoped MCP tools require the caller JWT; `agent-chat` forwards `Authorization` automatically.
