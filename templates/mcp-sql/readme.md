# MCP SQL

A **tool template** for [mcp-server](../mcp-server). It gives whatever agent
connects to the MCP server **RLS-scoped Postgres access as the signed-in user** —
without ever handing out a privileged database client.

It adds five tools: `query_sql`, `execute_sql`, `list_database_objects`,
`describe_table`, `describe_function`.

## How it stays safe

Access is bounded by several independent layers (no single one is the boundary):

1. **Dedicated login role** (`mcp_sql_executor`) — unprivileged, `NOINHERIT`,
   member of `authenticated` only, owns nothing. There is nothing privileged for
   untrusted SQL to escape into. Created and validated by the migrations.
2. **SQL-AST policy** ([`_shared/agent-sql/policy.ts`](supabase/functions/_shared/agent-sql/policy.ts))
   — parses each statement with the real Postgres grammar and accepts only
   `SELECT` (query) or `INSERT/UPDATE/DELETE/MERGE` (mutation); rejects DDL,
   procedural commands, `SELECT INTO`, row-locking, and context-mutating
   functions.
3. **Transaction-local identity** — each statement runs inside one transaction
   that sets `role`, `request.jwt.claims`, and `search_path` with `SET LOCAL`,
   then attests and re-verifies the context before commit. Each request also
   reserves its connection and runs `discard all` before the transaction, so a
   session-level GUC, advisory lock, temp table, or cursor left by a prior
   request's function body cannot leak across pooled requests.
4. **Resource limits** — statement size, row count, result bytes, statement and
   lock timeouts (all configurable). A `RETURNING` mutation is capped at the
   database, not in client memory: the write runs in full while the returned rows
   are bounded and `rowCount` still reports the true affected-row count.
5. **Supabase RLS** — the final boundary; agent SQL inherits exactly the
   `authenticated` grants and policies you define.

Catalog tools share one disclosure surface: `describe_table` and
`describe_function` exclude the same internal schemas (`auth`, `vault`,
`storage`, …) that `list_database_objects` hides, in addition to privilege
filtering.

See [`_shared/agent-sql/README.md`](supabase/functions/_shared/agent-sql/README.md)
for the full security contract, threat-model table, and documented limitations.

## Composition

This template is **purely additive** to the mcp-server function (the
[composition contract](../mcp-server/readme.md#composition-contract)):

- It drops tool files under `supabase/functions/mcp-server/tools/`, the
  `sql-runtime.ts` singleton, and the `_shared/agent-sql/` library.
- The library is imported with **relative paths**, so no framework files
  (`index.ts`, `auth.ts`, `deno.json`) are touched.
- Shared MCP result helpers come from the base **mcp-server** framework.
- It ships its own `tools/index.ts` aggregator (framework examples + SQL tools)
  for the standalone `mcp-server + mcp-sql` install. The
  [headless-app](../headless-app) block ships the final aggregator when more
  tools are composed.

## Required configuration

Not shipped here — the [headless-app](../headless-app) block provides the merged
versions. Standalone, add these to your project:

**`supabase/config.toml`** — enable the demo/executor seed:

```toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql", "./seed/*.sql"]
```

**`supabase/functions/.env`** — the executor connection string and optional limits:

```bash
# LOCAL works as-is after `supabase db reset` (seed.sql sets the matching password).
MCP_DB_URL=postgresql://mcp_sql_executor:local-dev-password@db:5432/postgres

# Optional limits (safe defaults in code):
# MCP_SQL_MAX_ROWS=1000
# MCP_SQL_STATEMENT_TIMEOUT_MS=15000
```

| Env var | Default |
| --- | --- |
| `MCP_DB_URL` | _(required)_ executor login connection string |
| `MCP_SQL_MAX_QUERY_BYTES` | `65536` |
| `MCP_SQL_MAX_ROWS` | `1000` |
| `MCP_SQL_MAX_RESULT_BYTES` | `1000000` |
| `MCP_SQL_STATEMENT_TIMEOUT_MS` | `15000` |
| `MCP_SQL_LOCK_TIMEOUT_MS` | `2000` |

## Granting access to your data

Agent SQL can only do what `authenticated` is granted. Out of the box that is
nothing. For each table:

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
alter table public.todos enable row level security;
create policy "Users access their own todos"
  on public.todos for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

## Verify

```bash
# Unit tests for the policy + RLS adapter
deno test supabase/functions/_shared/agent-sql/

# End-to-end against a running local stack (OAuth + RLS boundary)
deno run -A scripts/local-mcp-e2e.ts
```

## Dependencies

Requires [mcp-server](../mcp-server). Bundled by the
[headless-app](../headless-app) block.
