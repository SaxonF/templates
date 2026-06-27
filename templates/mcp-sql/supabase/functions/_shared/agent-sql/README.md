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

Mutation `RETURNING` is capped at the database, not in client memory. A
`RETURNING` mutation runs inside `with __agent_mutation as (<stmt>) select *,
count(*) over () as __agent_total from __agent_mutation limit maxRows + 1`: the
write still executes in full inside the CTE, `rowCount` reports the true
affected-row count (`__agent_total`), the returned rows are bounded to `maxRows`,
and `truncated` is set when more rows were affected than returned. The synthetic
total column is stripped before rows reach the client. Mutations without
`RETURNING` run unchanged and report the driver's affected-row count.

The database schema is trusted code. The parser cannot infer side effects hidden
inside functions, operators, casts, views, triggers, or defaults. Do not grant
untrusted users CREATE on searched schemas, and review every function executable
by the database role—especially security-definer or network-capable functions.

The parser is a PostgreSQL 16 `libpg_query` build packaged by
`pg-query-emscripten`. It provides the real PostgreSQL AST without filesystem
WASM loading, which is compatible with restricted Edge runtimes. PostgreSQL 15
and 17 are the supported database targets; version-specific syntax outside the
accepted parser grammar fails closed.

## Threat model

Safety is a stack of independent layers, each with a test that proves it. No
single layer is the boundary; defeating one still leaves the others.

| Layer | What it stops | Test that proves it |
| --- | --- | --- |
| Executor-role isolation | A privileged connection (e.g. `postgres`) silently running agent SQL with superuser / `BYPASSRLS` privileges. Attestation refuses any connection whose `session_user` is not the `NOINHERIT`, owns-nothing login role that is a member of `authenticated` only. | `supabase-rls_test.ts` (fabricated privileged row rejected); `database_identity_test.ts` (F5, real `postgres` URL → `EXECUTOR_ATTESTATION_FAILED`) |
| AST policy | DDL, procedural/transaction commands, `SELECT INTO`, read-side row locks, multi-statement piggybacking, and forbidden functions (`set_config`, persistent advisory lock/unlock, `pg_notify`) — rejected from the real PostgreSQL AST before execution. | `policy_test.ts` |
| Transaction-local identity + verification | An agent (or a function body) changing `role`, `request.jwt.claims`, `search_path`, or `auth.uid()` for the request. Identity is installed `SET LOCAL`, attested at install, and re-verified before commit. | `supabase-rls_test.ts`; `database_integration_test.ts` |
| Resource limits / DoS | Unbounded result memory, runaway statements, and `RETURNING`-mutation memory blowups. `statement_timeout` interrupts long statements (incl. `pg_sleep` and advisory-lock waits); `lock_timeout` bounds row-lock waits; rows/bytes are bounded; mutation `RETURNING` is DB-capped. | `runtime_resource_test.ts` (bounding/wrap shape, no DB); `database_resource_test.ts` (timeouts, F1 RETURNING cap, giant-row bounding) |
| Connection hygiene (F2) | A function body's session-level GUC (e.g. `set_config('app.tenant', …, false)`), session advisory locks, temp tables, or cursors leaking to the next pooled request. Each request reserves a connection and runs `discard all` before `begin`. | `database_resource_test.ts` (F2 — poisoned GUC cleared across requests) |
| Catalog exclusion parity (F3) | `describe_table` / `describe_function` disclosing objects in excluded schemas (`auth`, `vault`, `storage`, …) that `list_database_objects` already hides — even when a privilege happens to exist. | `database_catalog_test.ts` |
| Row Level Security | One user's agent reading or writing another user's rows. The final boundary: agent SQL inherits exactly the `authenticated` grants and RLS policies you define. | `database_integration_test.ts`; `scripts/validate-mcp.ts` (cross-user SELECT / UPDATE / MERGE over real MCP + OAuth) |

### Documented limitations

These are real, characterized boundaries — encoded as clearly-named tests, not
bugs to fix in the runtime. They all reduce to the **trusted-schema assumption**:
the database schema (functions, triggers, views, defaults) is trusted code that
the AST policy cannot see inside. The controls are grant hygiene and CREATE
hygiene, not the runtime.

- **F6 — net-only context verification is bypassable by save/restore.** `verify()`
  compares the post-commit context snapshot to the install snapshot. A SECURITY
  INVOKER function that saves the current `request.jwt.claims`, swaps in another
  user's claims to read their rows, then restores the *exact* prior claims string
  before returning leaves the net context unchanged, so verification passes and
  the cross-user read is **not** caught. The only real controls are: do not grant
  EXECUTE on such functions to `authenticated`, and do not let untrusted users
  CREATE functions on reachable schemas. Characterized in
  `database_identity_test.ts` (the test name says DOCUMENTED LIMITATION).
- **F7 — SECURITY DEFINER escalation.** A definer function runs with its owner's
  privileges and bypasses RLS for whatever it touches; the policy cannot see
  inside it. `describe_function` surfaces `security: "definer"` and a non-null
  `security_warning` so an agent is warned, but the leak is outside the policy
  boundary. Characterized in `database_identity_test.ts` (F7).
- **`pg_sleep` and transaction-scoped advisory locks are intentionally allowed.**
  `pg_sleep(…)` and `pg_advisory_xact_lock(…)` pass the policy by design; they are
  bounded by `statement_timeout`. Note `lock_timeout` does **not** apply to
  advisory-lock waits — only `statement_timeout` does. Proven in
  `database_resource_test.ts`.
- **MERGE … RETURNING never reaches the runtime.** The PG16 `libpg_query` parser
  rejects `MERGE … RETURNING` (a PG17 addition), so plain `MERGE` works but
  `MERGE` with `RETURNING` fails closed at parse time. A known parser limitation,
  not a policy decision.

## Pooling and transactions

The runtime is compatible with Supavisor transaction mode:

- Postgres.js prepared statements are disabled.
- Every operation owns exactly one short transaction.
- Each request reserves a dedicated pooled connection and runs `discard all`
  **before** `begin`, clearing any session-level GUC, advisory lock, temp table,
  or cursor a prior request's function body may have left behind. The connection
  is released back to the pool in `finally`.
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
