# Agent template

Build persistent AI agents on Supabase with a streaming chat endpoint, session history, long-term memory, and MCP tool access. The generated `agent-chat` Edge Function uses the AI SDK to stream model responses back to clients while persisting user and assistant messages in Postgres.

The agent can call tools from connected MCP servers. If you also add the **mcp-server** template, the agent can use that local Edge Function MCP server as one of its tool sources.

## What's included

| Asset         | Path                                      | Purpose                                      |
| ------------- | ----------------------------------------- | -------------------------------------------- |
| Schema        | `supabase/schemas/agent.sql`              | Sessions, messages, memory, MCP servers, RLS |
| Edge Function | `supabase/functions/agent-chat/index.ts`  | Streaming AI SDK chat endpoint               |

### Sessions and messages

Each session belongs to a user. `agent-chat` creates a session when `sessionId` is omitted, appends the user message, streams the model response, then persists the assistant response.

### Memory and recall

Memory rows can store arbitrary JSON payloads. Add the **ai-vector-search** or **ai-automatic-embeddings** template for embedding columns, HNSW indexes, and similarity search helpers. The base agent schema intentionally omits pgvector objects so `supabase db diff` works reliably on fresh projects.

### MCP tools

`agent-chat` discovers tools from MCP servers and exposes them to the AI SDK model call. By default, it attempts to connect to the local `mcp-server` Edge Function at:

```text
${SUPABASE_URL}/functions/v1/mcp-server
```

You can also add rows to `public.agent_mcp_servers`:

```sql
insert into public.agent_mcp_servers (name, url)
values ('project', 'https://<project-ref>.supabase.co/functions/v1/mcp-server');
```

or pass request-scoped MCP servers:

```ts
const response = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sessionId,
    message: 'List the public tables in my project',
    mcpServers: [
      {
        name: 'project',
        url: `${supabaseUrl}/functions/v1/mcp-server`,
      },
    ],
  }),
})
```

Tool names are namespaced as `<server>_<tool>`, so a `list_tables` tool from the local MCP server is exposed to the model as `project_list_tables`.

## Dependencies

**Required**

- `database` — base Supabase project config
- `api` — REST/GraphQL surface for client access
- `auth` — user-scoped sessions and RLS
- `functions` — Edge Functions runtime

**Optional**

- `ai-vector-search` — pgvector similarity over memory embeddings
- `ai-automatic-embeddings` — keep embeddings in sync via triggers
- `mcp-server` — local Edge Function MCP server the agent can call for project tools

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
- MCP server load failures are logged server-side; check that `${SUPABASE_URL}/functions/v1/mcp-server` is reachable and the user's JWT is forwarded in the `Authorization` header.
