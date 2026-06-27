# Headless App

A **composition block** — not a standalone template. It installs the common
Backplane stack for a headless app where authenticated agents get user-scoped
database access plus Supabase-native workflow, storage, tenancy, knowledge, and
observability tools over MCP:

| Dependency | What it adds |
| --- | --- |
| [mcp-server](../mcp-server) | The MCP server framework: Streamable HTTP transport, dual OAuth 2.1 + first-party JWT auth, tool registry. |
| [mcp-auth-ui](../mcp-auth-ui) | The OAuth front-end: sign-in, consent, client management, setup wizard. |
| [mcp-sql](../mcp-sql) | RLS-scoped database tools (`query_sql`, `execute_sql`, schema introspection) via the `agent-sql` runtime + a dedicated executor role. |
| [mcp-functions](../mcp-functions) | Scaffold for named, schema-validated Edge Function tools. |
| [mcp-workflows](../mcp-workflows) | Enqueue, inspect, cancel, and retry durable workflow runs. |
| [mcp-storage](../mcp-storage) | Storage listing, signed URLs, moves, copies, and deletes under Storage policies. |
| [mcp-tenancy](../mcp-tenancy) | Organization discovery, membership listing, and RBAC permission checks. |
| [mcp-knowledge](../mcp-knowledge) | RAG ingestion and search tools. |
| [mcp-observability](../mcp-observability) | User-scoped app logs and failed-workflow inspection. |

Because shadcn copies whole files (no merge), this block also **owns the few
files that must be merged across those templates**:

- `supabase/config.toml` — the framework's auth/runtime/storage config **plus**
  `[db.seed]` for the executor password and demo data.
- `supabase/functions/.env.example` — the merged env (`MCP_SERVER_*`,
  `MCP_DB_URL`, `MCP_SQL_*`).
- `supabase/functions/mcp-server/tools/index.ts` — the **canonical tool
  aggregator**. Edit this file to add more tool templates.

The dependencies install first, so these merged files overwrite the
per-template versions last — which is exactly what you want.

## Install

```bash
npx shadcn@latest add SaxonF/templates/headless-app
```

This resolves and installs the MCP framework plus the Supabase-native tool
packs, then lands the merged files above.

> Want a chat agent too? The [agent](../agent) template is intentionally
> **not** part of this block (it is standalone). Install it separately
> (`npx shadcn@latest add SaxonF/templates/agent`); it connects to this MCP
> server automatically and forwards the user's JWT to the first-party auth path.

## Run locally

Prerequisites: Docker, Supabase CLI 2.90.0+, and Python 3 (or any static file
server).

1. Start Supabase and apply migrations:

   ```bash
   supabase start
   supabase db reset
   ```

2. Copy the local publishable key from `supabase status -o env` into
   `public/config.js`.

3. Configure the function (no edit needed locally — the seed sets the executor
   password to match the committed `MCP_DB_URL`):

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   ```

4. Serve the function and the OAuth UI in separate terminals:

   ```bash
   supabase functions serve mcp-server --env-file supabase/functions/.env
   ```

   ```bash
   python3 -m http.server 3000 --directory public
   ```

5. Connect an OAuth-capable MCP client at
   `http://127.0.0.1:54321/functions/v1/mcp-server`, or point the
   [agent](../agent) at the same project.

Knowledge tools require `OPENAI_API_KEY` for the RAG embedding/query functions.
Workflow tools require adding handlers in `workflow-worker/index.ts` for your
app-specific workflow types.

## Grant the agent access to your data

The block grants no application-table privileges by default. For each table the
agent should reach, grant `authenticated` and constrain rows with RLS:

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
alter table public.todos enable row level security;
create policy "users access their own todos"
  on public.todos for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

## Add another tool template

1. Install it: `npx shadcn@latest add SaxonF/templates/<tool>`.
2. Add its `register*Tools` calls to `supabase/functions/mcp-server/tools/index.ts`
   (this block owns that aggregator).

See the [mcp-server composition contract](../mcp-server/readme.md#composition-contract)
and the [mcp-sql security contract](../mcp-sql/readme.md#how-it-stays-safe) for
the details each layer enforces.

## Deploy

```bash
supabase link --project-ref PROJECT_REF
supabase db push
supabase config push      # enables the access-token hook + OAuth server
supabase functions deploy mcp-server
```

Then provision the executor login (the one secret to set by hand):

```bash
supabase db query --linked "alter role mcp_sql_executor with password '<STRONG_PASSWORD>';"

# Copy the Transaction pooler host from Dashboard → Database (e.g.
# aws-0-ap-southeast-2.pooler.supabase.com). Username: mcp_sql_executor.<PROJECT_REF>.
supabase secrets set \
  MCP_DB_URL="postgresql://mcp_sql_executor.<PROJECT_REF>:<STRONG_PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  MCP_RESOURCE_URL="https://<project-ref>.supabase.co/functions/v1/mcp-server" \
  MCP_AUTH_ISSUER="https://<project-ref>.supabase.co/auth/v1"
```

Host `public/` at an HTTPS origin and set it as the Auth Site URL. On hosted
Supabase, `MCP_RESOURCE_URL` and `MCP_AUTH_ISSUER` are required — Edge Functions
otherwise advertise internal URLs and OAuth clients cannot discover auth. For
custom domains, point those vars at your public origin instead.
