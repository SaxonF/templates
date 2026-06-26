# User-scoped Postgres for agents

This template gives an authenticated agent direct PostgreSQL access while
keeping Supabase grants and Row Level Security (RLS) as the data-authorization
boundary. The MCP server is only one transport over a reusable SQL runtime; the
runtime itself has no dependency on MCP, HTTP, or Supabase Auth.

The direct connection means SQL tools continue to work when the Supabase Data
API is disabled. It also means agent SQL is untrusted database input. The
runtime therefore combines a least-privilege login role, PostgreSQL AST
validation, transaction-local user identity, post-statement context
verification, read/write separation, and resource limits. None of those controls
is sufficient on its own.

## Architecture

```text
MCP client
  -> OAuth 2.1 protected resource
  -> verified Supabase user + JWT claims
  -> MCP tool adapter
  -> agent-sql runtime
       -> PostgreSQL AST policy
       -> transaction and resource limits
       -> Supabase RLS identity adapter
       -> isolated mcp_sql_executor connection
            SET LOCAL ROLE authenticated
            SET LOCAL request.jwt.claims = <verified claims>
            agent statement
            verify role, claims, search_path and auth.uid()
  -> PostgreSQL grants + RLS
```

The boundaries are deliberately separate:

- `supabase/functions/mcp-server/` owns OAuth, MCP transport, tool schemas, and
  result formatting.
- `supabase/functions/_shared/agent-sql/` owns SQL parsing, execution policy,
  database transactions, bounded results, catalog access, and identity-adapter
  interfaces.
- `createSupabaseRlsAdapter` is the Supabase-specific bridge. Another
  authenticated system can provide a different identity adapter without changing
  the SQL policy or MCP layer.
- The runtime is consumed as a self-contained library. It has its own
  `deno.json` (name `@supabase-agent/agent-sql`, exporting `./mod.ts`) and the
  MCP function imports it through the `@agent-sql` alias rather than a deep
  relative path. To publish it standalone, run `deno publish` from
  `supabase/functions/_shared/agent-sql/` and repoint that one alias at
  `jsr:@supabase-agent/agent-sql`; no runtime code changes.
- Project workflows that use secrets, external APIs, or retries belong behind
  explicit typed Edge Function tools. The template does not expose a generic
  function dispatcher.

There is intentionally no public raw database client or unchecked SQL method.

## Included MCP tools

- `query_sql`: one `SELECT`, executed in a read-only transaction.
- `execute_sql`: one `INSERT`, `UPDATE`, `DELETE`, or `MERGE` statement.
- `list_database_objects`: paginated, privilege-filtered relations and callable
  functions.
- `describe_table`: accessible columns, keys, comments, relation kind, and RLS
  state.
- `describe_function`: accessible overloads, arguments, return types,
  volatility, language, and invoker/definer security.

Both SQL tools support normal PostgreSQL expressions, joins, subqueries, and
CTEs within their mode. The parser rejects multiple statements, DDL,
transaction/session commands, procedural commands, `SELECT INTO`, read-side row
locks, `set_config`, and persistent advisory-lock functions. Query results,
statement size, statement duration, lock wait, and returned bytes are bounded.

## Security contract

### What is enforced

Every database operation:

1. Validates an already-verified principal with a UUID `sub`, `authenticated`
   role, and valid expiry.
2. Parses SQL with a PostgreSQL parser and accepts only the statement roots
   allowed by the selected mode.
3. Opens a short transaction through the unprivileged `mcp_sql_executor` login.
4. Attests that the login is `NOINHERIT`, is a member of exactly
   `authenticated`, owns no database objects, and has no superuser,
   role-management, replication, or RLS-bypass capability.
5. Installs `authenticated`, verified JWT claims, timeouts, and a fixed search
   path with transaction-local settings.
6. Runs the statement.
7. Verifies `session_user`, `current_user`, exact claims, search path, and
   `auth.uid()` before commit. Any mismatch rolls the transaction back and
   returns no rows.

The connection must never use `postgres`, `service_role`, an object owner, or
any role that can become a privileged role. `RESET ROLE` is dangerous when the
session login is privileged; the isolated login makes reset fall back to an
unprivileged role, while the parser rejects the statement before execution.

### Trusted database code

AST validation is a guardrail, not a PostgreSQL sandbox. A statement can invoke
behavior hidden behind a function, operator, cast, view, trigger, generated
expression, default, or RLS policy. In particular, a `SECURITY DEFINER` function
can intentionally exceed the caller's ordinary privileges.

Treat executable database objects as trusted application code:

- Do not grant `authenticated` or `PUBLIC` `CREATE` on any searched schema.
- Revoke default `PUBLIC EXECUTE` from sensitive functions and grant functions
  explicitly.
- Audit every `SECURITY DEFINER`, network-capable, dynamic-SQL, or
  configuration-changing function reachable by `authenticated`.
- Give security-definer functions a fixed safe `search_path`, schema-qualify
  objects, and perform their own authorization.
- Keep extension schemas and internal Supabase schemas out of the agent search
  path and catalog.
- Treat triggers and RLS policies as part of the same trusted-code review.

The runtime rechecks identity after a statement, so a hidden function that
leaves claims or role changed causes a rollback. It cannot prove that a function
temporarily changed identity and restored it, or undo non-transactional external
effects. That is why database-code review remains a required boundary.

### Pooling model

The runtime is compatible with Supavisor transaction mode:

- prepared statements are disabled;
- each operation owns one transaction;
- request context is transaction-local;
- query mode uses `BEGIN READ ONLY`;
- no transaction or connection state spans MCP calls.

For atomic database work, use one statement or a data-modifying CTE in
`execute_sql`. For payment, email, third-party API, secret-bearing, or retryable
multi-step work, expose a typed Edge Function tool.

## Run locally

Prerequisites: Docker, Supabase CLI 2.90.0 or later, Node.js 20 or later, and
Python 3 (or another static file server).

1. Start Supabase and apply migrations:

   ```bash
   supabase start
   supabase db reset
   ```

2. Copy the local publishable key from `supabase status -o env` into
   `public/config.js`:

   ```js
   export const SUPABASE_URL = "http://127.0.0.1:54321";
   export const SUPABASE_PUBLISHABLE_KEY = "your-local-publishable-key";
   export const MCP_SERVER_NAME = "your-app";
   export const MCP_SERVER_DESCRIPTION =
     "MCP access to your app database for the signed-in user.";
   ```

3. Configure the function:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   ```

   No edit is required: `supabase db reset` runs `supabase/seed.sql`, which sets
   the isolated login's local password to match the committed `MCP_DB_URL`. The
   seed is local-only and never reaches a hosted project.

4. Serve the function and authorization UI in separate terminals:

   ```bash
   supabase functions serve mcp-server --env-file supabase/functions/.env
   ```

   ```bash
   python3 -m http.server 3000 --directory public
   ```

5. Connect an OAuth-capable MCP client:

   ```bash
   codex mcp add local-your-app \
     --url http://127.0.0.1:54321/functions/v1/mcp-server
   codex mcp login local-your-app
   ```

Use `127.0.0.1` consistently. OAuth issuer, resource, audience, and redirect
comparisons are exact.

## Grant application data

The template grants no application-table privileges by default. Grant only the
operations the agent needs and enforce ownership in RLS:

```sql
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;

alter table public.todos enable row level security;

create policy "users access their own todos"
on public.todos
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

Grant only `SELECT` for a read-only application. Table owners normally bypass
RLS, which is another reason the executor must own nothing. Use
`FORCE ROW LEVEL SECURITY` as defense in depth where owner access is not
required, but do not substitute it for an isolated login.

## Runtime configuration

The MCP adapter reads:

| Variable                       | Purpose                                                          |   Default |
| ------------------------------ | ---------------------------------------------------------------- | --------: |
| `MCP_DB_URL`                   | Required direct or transaction-pooler URL for `mcp_sql_executor` |      none |
| `MCP_SERVER_NAME`              | Short project-specific MCP server/client name                    | `supabase-agent` |
| `MCP_SERVER_DESCRIPTION`       | User-facing connector text and prefix for MCP instructions       | see code |
| `MCP_SQL_MAX_QUERY_BYTES`      | Maximum UTF-8 SQL size                                           |   `65536` |
| `MCP_SQL_MAX_ROWS`             | Maximum returned rows                                            |    `1000` |
| `MCP_SQL_MAX_RESULT_BYTES`     | Approximate JSON result-byte cap                                 | `1000000` |
| `MCP_SQL_STATEMENT_TIMEOUT_MS` | Per-statement timeout                                            |   `15000` |
| `MCP_SQL_LOCK_TIMEOUT_MS`      | Lock-wait timeout                                                |    `2000` |

For hosted Supabase, use the transaction pooler and set the secret out of band:

```bash
supabase secrets set \
  MCP_DB_URL="postgresql://mcp_sql_executor.PROJECT_REF:STRONG_PASSWORD@REGION.pooler.supabase.com:6543/postgres" \
  MCP_SERVER_NAME="your-app" \
  MCP_SERVER_DESCRIPTION="MCP access to your app database for the signed-in user."
```

The runtime fails closed when this variable is absent or when role attestation
fails. This connection path does not use PostgREST or the Data API.

## Deploy

1. Host `public/` at an HTTPS origin, update `public/config.js`, and configure
   its root as the Auth Site URL.
2. In Supabase Auth, enable the OAuth server, use `/oauth/consent/` as its
   authorization path, and enable dynamic client registration.
3. Use an asymmetric JWT signing key.
4. Apply migrations and deploy:

   ```bash
   supabase link --project-ref PROJECT_REF
   supabase db push
   supabase config push
   supabase functions deploy mcp-server
   ```

   `supabase config push` enables the Custom Access Token hook
   `private.mcp_custom_access_token_hook` from `config.toml`. It adds the
   canonical MCP resource to OAuth-token audiences; ordinary Supabase sessions
   are not changed. No dashboard toggle is required.

5. Provision the isolated executor — the only secret to set by hand. Set the
   role password once, then store the pooler connection string as a secret:

   ```bash
   # as the postgres/admin role:
   #   alter role mcp_sql_executor with password '<STRONG_PASSWORD>';
   supabase secrets set \
     MCP_DB_URL="postgresql://mcp_sql_executor.PROJECT_REF:STRONG_PASSWORD@REGION.pooler.supabase.com:6543/postgres"
   ```

`verify_jwt` is deliberately disabled for the Edge Function so unauthenticated
clients can receive OAuth discovery metadata. The function itself verifies the
bearer token signature, issuer, OAuth `client_id`, resource audience,
authenticated role, and live Auth session before creating tool context.

If a custom domain is used, configure `MCP_RESOURCE_URL` and `MCP_AUTH_ISSUER`
so the resource, issuer, access-token hook, and client configuration use the
same canonical origins.

## Add project tools

Add explicit tools in `supabase/functions/mcp-server/tools/index.ts`. Database
tools should call the shared runtime, not construct a second database
connection. External workflows should map one typed MCP tool to one Edge
Function through `invokeEdgeFunction`; do not expose a caller-selected function
name or caller-controlled headers.

The helper forwards the authenticated user's token. The target function must
still authenticate and authorize the request, ideally by using a user-scoped
Supabase client and RLS.

## Verification checklist

Before deploying a schema or grant change:

- Sign in as two users and seed one owned row for each.
- Confirm `query_sql` returns only the caller's row and `auth.uid()` matches the
  OAuth subject.
- Confirm `execute_sql` cannot update or delete the other user's row.
- Confirm an allowed mutation with `RETURNING` succeeds for the caller's row.
- Confirm `set_config`, `SET ROLE`, DDL, multiple statements, data-modifying
  query CTEs, and oversized/slow queries fail.
- Confirm catalog tools omit inaccessible objects.
- Confirm the executor attestation fails after adding any role membership,
  ownership, or privileged flag.
- Revoke the OAuth grant and confirm the next MCP request requires
  authentication.

Run the local static tests with:

```bash
deno test \
  supabase/functions/_shared/agent-sql/policy_test.ts \
  supabase/functions/_shared/agent-sql/supabase-rls_test.ts

# Type-check through the function's deno.json so the @agent-sql import resolves:
deno check --config supabase/functions/mcp-server/deno.json \
  supabase/functions/mcp-server/index.ts
```

With local Supabase and `mcp-server` running, execute the complete two-user
OAuth/MCP/RLS test (use values from `supabase status -o env`):

```bash
SUPABASE_PUBLISHABLE_KEY='local-publishable-key' \
SUPABASE_SERVICE_ROLE_KEY='local-service-role-key' \
deno run --allow-env --allow-net \
  scripts/local-mcp-e2e.ts
```

This test uses the service-role key only to create and remove isolated local
test users. That key is never sent to MCP or installed as database request
context. The script obtains a separate PKCE OAuth access token for each user,
creates a temporary RLS fixture through the local admin connection, validates
MCP reads and mutations, rejects `set_config`, and cleans up in `finally`.

## References

- [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL role membership](https://www.postgresql.org/docs/current/role-membership.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
