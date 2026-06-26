# Headless App

A **composition block** — not a standalone template. It installs everything you
need to stand up a headless app where an authenticated agent gets RLS-scoped
Postgres access over MCP:

| Dependency | What it adds |
| --- | --- |
| [mcp-server](../mcp-server) | The MCP server framework: Streamable HTTP transport, dual OAuth 2.1 + first-party JWT auth, tool registry. |
| [mcp-auth-ui](../mcp-auth-ui) | The OAuth front-end: sign-in, consent, client management, setup wizard. |
| [mcp-sql](../mcp-sql) | RLS-scoped database tools (`query_sql`, `execute_sql`, schema introspection) via the `agent-sql` runtime + a dedicated executor role. |

Because shadcn copies whole files (no merge), this block also **owns the few
files that must be merged across those templates**:

- `supabase/config.toml` — the framework's auth/runtime config **plus**
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

This resolves and installs `mcp-server` → `mcp-auth-ui` → `mcp-sql`, then lands
the merged files above.

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
2. Add its `register*` calls to `supabase/functions/mcp-server/tools/index.ts`
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
# as the postgres/admin role: alter role mcp_sql_executor with password '<STRONG_PASSWORD>';
supabase secrets set \
  MCP_DB_URL="postgresql://mcp_sql_executor.PROJECT_REF:STRONG_PASSWORD@REGION.pooler.supabase.com:6543/postgres"
```

Host `public/` at an HTTPS origin and set it as the Auth Site URL. For custom
domains, set `MCP_RESOURCE_URL` and `MCP_AUTH_ISSUER`.
