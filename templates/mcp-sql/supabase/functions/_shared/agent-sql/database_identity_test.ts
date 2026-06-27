import postgres from "npm:postgres@3.4.7";

import { createSupabaseRlsAdapter } from "./adapters/supabase-rls.ts";
import { AgentSqlError } from "./errors.ts";
import { createAgentSqlRuntime } from "./runtime.ts";

// Integration tests are env-gated, exactly like database_integration_test.ts.
// AGENT_SQL_TEST_ADMIN_URL connects as `postgres` (privileged).
// AGENT_SQL_TEST_DATABASE_URL connects as the isolated `mcp_sql_executor`.
const adminUrl = Deno.env.get("AGENT_SQL_TEST_ADMIN_URL");
const executorUrl = Deno.env.get("AGENT_SQL_TEST_DATABASE_URL");
const enabled = Boolean(adminUrl && executorUrl);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCHEMA = "agent_sql_identity_test";

function principal(sub: string) {
  return {
    claims: {
      sub,
      role: "authenticated",
      aud: ["authenticated"],
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  };
}

function createRuntime(databaseUrl: string, limits = {}) {
  return createAgentSqlRuntime({
    databaseUrl,
    identity: createSupabaseRlsAdapter({
      loginRole: "mcp_sql_executor",
      databaseRole: "authenticated",
      searchPath: ["public", "extensions"],
    }),
    limits: {
      maxRows: 10,
      statementTimeoutMs: 2_000,
      lockTimeoutMs: 500,
      ...limits,
    },
  });
}

// F5 — Privileged-executor rejection against a REAL privileged connection.
//
// The unit tests prove attestation rejects a fabricated privileged row. This
// proves the same against a live `postgres` connection: `session_user` is
// `postgres`, not `mcp_sql_executor`, and it is superuser/owns objects, so the
// adapter must refuse to run any agent SQL on it.
Deno.test({
  name:
    "database identity (F5): runtime on the admin/postgres URL fails EXECUTOR_ATTESTATION_FAILED",
  ignore: !enabled,
  async fn() {
    // Build a runtime whose databaseUrl is the ADMIN url (connects as postgres).
    const runtime = createRuntime(adminUrl!);
    try {
      await runtime.query(principal(USER_A), "select 1");
      throw new Error(
        "Expected attestation to reject the privileged postgres connection",
      );
    } catch (error) {
      if (
        !(error instanceof AgentSqlError) ||
        error.code !== "EXECUTOR_ATTESTATION_FAILED"
      ) {
        throw error;
      }
    } finally {
      await runtime.close();
    }
  },
});

// Happy path — attestation passes for the real isolated `mcp_sql_executor` role.
Deno.test({
  name:
    "database identity: runtime on the executor URL attests and runs select 1",
  ignore: !enabled,
  async fn() {
    const runtime = createRuntime(executorUrl!);
    try {
      const result = await runtime.query(
        principal(USER_A),
        "select 1 as one",
      );
      if (result.rows.length !== 1 || result.rows[0].one !== 1) {
        throw new Error(
          `Expected attestation to pass and select 1 to return: ${
            JSON.stringify(result)
          }`,
        );
      }
    } finally {
      await runtime.close();
    }
  },
});

// F6 — DOCUMENTED LIMITATION: net-only verification is bypassable by save/restore.
//
// `verify()` only compares the post-execution context snapshot to the install
// snapshot. A SECURITY INVOKER function that (1) saves the current claims, (2)
// swaps in another user's claims to read their row, then (3) restores the EXACT
// prior claims string before returning leaves the net context unchanged — so
// verification passes and the cross-user read is NOT caught.
//
// This is a real, documented trust boundary, not a bug to "fix" here. The DB
// schema is trusted code. The ONLY real controls are:
//   - do NOT grant EXECUTE on such functions to `authenticated`, and
//   - do NOT let untrusted users CREATE functions (i.e. no CREATE on schemas
//     reachable by `authenticated`).
// We deliberately grant execute below to demonstrate the bypass; in production
// that grant is the actual vulnerability, not the runtime's net-only verify.
Deno.test({
  name:
    "DOCUMENTED LIMITATION: invoker fn that restores claims defeats net-only verification (mitigated only by grant/CREATE hygiene)",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime(executorUrl!);

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.notes (
          user_id uuid not null,
          body text not null
        )
      `);
      await admin.unsafe(
        `alter table ${SCHEMA}.notes enable row level security`,
      );
      await admin.unsafe(`
        create policy notes_by_owner on ${SCHEMA}.notes
        for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant select on ${SCHEMA}.notes to authenticated`,
      );
      await admin.unsafe(
        `insert into ${SCHEMA}.notes (user_id, body) values ($1, 'b-secret')`,
        [USER_B],
      );

      // SECURITY INVOKER function: save claims, impersonate USER_B, read B's
      // row, then RESTORE the exact prior claims string before returning. The
      // net context is unchanged, so the runtime's net-only verify() passes.
      await admin.unsafe(`
        create function ${SCHEMA}.leak()
        returns text
        language plpgsql
        security invoker
        as $$
        declare
          saved_claims text;
          leaked text;
        begin
          saved_claims := current_setting('request.jwt.claims');
          perform set_config(
            'request.jwt.claims',
            '{"sub":"${USER_B}","role":"authenticated"}',
            true
          );
          select body into leaked
          from ${SCHEMA}.notes
          where user_id = '${USER_B}';
          -- Restore the EXACT prior claims string so verify() sees no net change.
          perform set_config('request.jwt.claims', saved_claims, true);
          return leaked;
        end;
        $$
      `);
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.leak() to authenticated`,
      );

      // USER_A calls leak(). Because claims are restored to the exact prior
      // string before return, verify() passes and the call SUCCEEDS, returning
      // USER_B's body. This documents that the leak is NOT caught.
      const result = await runtime.query(
        principal(USER_A),
        `select ${SCHEMA}.leak() as leaked`,
      );
      if (result.rows[0]?.leaked !== "b-secret") {
        throw new Error(
          `DOCUMENTED LIMITATION expected the leak to succeed (claims restored), got: ${
            JSON.stringify(result)
          }`,
        );
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

// F7 — SECURITY DEFINER characterization.
//
// A SECURITY DEFINER function owned by a privileged role runs with the owner's
// privileges and bypasses RLS for whatever it reads. The AST policy cannot see
// inside it (trusted-schema assumption). We assert describeFunction surfaces
// security: "definer" + a non-null security_warning so an agent is warned, and
// that calling it returns cross-user data WITHOUT raising
// EXECUTION_CONTEXT_CHANGED (the definer leak is outside the policy boundary,
// and the request context — claims/role — is unchanged by the call).
Deno.test({
  name:
    "database identity (F7): describeFunction flags SECURITY DEFINER; the definer leak is outside policy scope",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime(executorUrl!);

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.notes (
          user_id uuid not null,
          body text not null
        )
      `);
      await admin.unsafe(
        `alter table ${SCHEMA}.notes enable row level security`,
      );
      await admin.unsafe(`
        create policy notes_by_owner on ${SCHEMA}.notes
        for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(`grant select on ${SCHEMA}.notes to authenticated`);
      await admin.unsafe(
        `insert into ${SCHEMA}.notes (user_id, body) values ($1, 'b-definer-secret')`,
        [USER_B],
      );

      // SECURITY DEFINER owned by postgres: reads USER_B's row regardless of the
      // caller's RLS context (definer privileges bypass RLS / the policy).
      await admin.unsafe(`
        create function ${SCHEMA}.read_other(target uuid)
        returns text
        language sql
        security definer
        set search_path = ${SCHEMA}
        as $$
          select body from ${SCHEMA}.notes where user_id = target
        $$
      `);
      // Owner defaults to the creating role (postgres) since admin connects as
      // postgres; make it explicit so the test documents the privileged owner.
      await admin.unsafe(
        `alter function ${SCHEMA}.read_other(uuid) owner to postgres`,
      );
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.read_other(uuid) to authenticated`,
      );

      // describeFunction must flag it as definer with a security_warning.
      const descriptions = await runtime.describeFunction(principal(USER_A), {
        schema: SCHEMA,
        name: "read_other",
      });
      const entry = descriptions[0] as Record<string, unknown> | undefined;
      if (!entry) {
        throw new Error(
          "Expected describeFunction to return the definer function entry",
        );
      }
      if (entry.security !== "definer") {
        throw new Error(
          `Expected security "definer", got: ${JSON.stringify(entry.security)}`,
        );
      }
      if (
        typeof entry.security_warning !== "string" ||
        entry.security_warning.length === 0
      ) {
        throw new Error(
          `Expected a non-null security_warning, got: ${
            JSON.stringify(entry.security_warning)
          }`,
        );
      }

      // Calling it returns cross-user data (documents that definer functions are
      // outside the RLS / policy boundary) and does NOT raise
      // EXECUTION_CONTEXT_CHANGED — the request context is unchanged.
      const leaked = await runtime.query(
        principal(USER_A),
        `select ${SCHEMA}.read_other('${USER_B}') as body`,
      );
      if (leaked.rows[0]?.body !== "b-definer-secret") {
        throw new Error(
          `Expected the definer function to read across users (out of policy scope): ${
            JSON.stringify(leaked)
          }`,
        );
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});
