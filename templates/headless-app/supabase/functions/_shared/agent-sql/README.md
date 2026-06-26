# Agent SQL runtime

This directory is a reusable, MCP-independent execution boundary for agent-
generated PostgreSQL. It owns SQL parsing, query/mutation classification,
transactions, resource limits, result bounding, catalog access, and pluggable
database identity setup.

The runtime deliberately does not verify JWTs, read environment variables,
construct HTTP/MCP responses, invoke Edge Functions, or expose its Postgres.js
client. Its caller must authenticate a principal first.

## Public API

Import from `mod.ts`:

```ts
const runtime = createAgentSqlRuntime({
  databaseUrl,
  identity: createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  }),
});

await runtime.query({ claims }, "select * from todos order by created_at");
await runtime.mutate(
  { claims },
  `update todos set done = true where id = '...' returning id, done`,
);
```

Catalog methods use the same identity and read-only transaction boundary:

- `listDatabaseObjects`
- `describeTable`
- `describeFunction`

There is intentionally no unchecked public SQL method.

## Identity adapters

An adapter validates an already-authenticated principal, installs its database
context inside the request transaction, captures a snapshot, and verifies that
snapshot after untrusted SQL but before commit.

The bundled Supabase adapter:

- Attests the isolated login role on every transaction.
- Switches to `authenticated`.
- Installs verified JWT claims transaction-locally.
- Fixes the search path.
- Checks `session_user`, `current_user`, claims, search path, and `auth.uid()`
  before commit.

JWT signature, issuer, audience, OAuth client, and live-session verification
belong to the caller. A non-Supabase integration can implement
`IdentityContextAdapter<Principal, Snapshot>` without changing policy or runtime
code.

## Security contract

Agent SQL is one SELECT or one INSERT/UPDATE/DELETE/MERGE. DDL, procedural and
transaction commands, `set_config`, persistent advisory locks, SELECT INTO, and
read-side row locks are rejected from the PostgreSQL AST.

Direct `pg_notify` calls are also rejected because notifications are external
effects despite not changing table rows.

The database schema is trusted code. The parser cannot infer side effects hidden
inside functions, operators, casts, views, triggers, or defaults. Do not grant
untrusted users CREATE on searched schemas, and review every function executable
by the database role—especially security-definer or network-capable functions.

The parser is a PostgreSQL 16 `libpg_query` build packaged by
`pg-query-emscripten`. It provides the real PostgreSQL AST without filesystem
WASM loading, which is compatible with restricted Edge runtimes. PostgreSQL 15
and 17 are the supported database targets; version-specific syntax outside the
accepted parser grammar fails closed.

## Pooling and transactions

The runtime is compatible with Supavisor transaction mode:

- Postgres.js prepared statements are disabled.
- Every operation owns exactly one short transaction.
- All request context is transaction-local.
- Query mode uses `BEGIN READ ONLY`.
- Transactions never span MCP calls.
- Telemetry runs after commit/rollback and contains no SQL, claims, or rows.

Use one SQL statement/CTE for atomic data-local work. Put external calls,
secrets, and retryable multi-step workflows behind typed Edge Function tools.

## Tests

The policy and identity-adapter tests require no database. The optional database
integration test creates an RLS fixture and proves two synthetic principals can
only read and mutate their own rows:

```bash
AGENT_SQL_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
AGENT_SQL_TEST_DATABASE_URL=postgresql://mcp_sql_executor:local-dev-password@127.0.0.1:54322/postgres \
deno test --allow-env --allow-net *_test.ts
```

The fixture schema is dropped in a `finally` block. This validates the runtime
boundary; the repository's final MCP test additionally validates OAuth, tool
registration, transport, and principal handoff.
