import postgres from "npm:postgres@3.4.7";

import { createSupabaseRlsAdapter } from "./adapters/supabase-rls.ts";
import { AgentSqlError } from "./errors.ts";
import { createAgentSqlRuntime } from "./runtime.ts";
import type { RuntimeLimits } from "./types.ts";

const adminUrl = Deno.env.get("AGENT_SQL_TEST_ADMIN_URL");
const executorUrl = Deno.env.get("AGENT_SQL_TEST_DATABASE_URL");
const enabled = Boolean(adminUrl && executorUrl);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCHEMA = "agent_sql_resource_test";

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

function createRuntime(
  limits: Partial<RuntimeLimits> = {},
  pool?: { maxConnections?: number },
) {
  return createAgentSqlRuntime({
    databaseUrl: executorUrl!,
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
    ...(pool ? { pool } : {}),
  });
}

Deno.test({
  name: "database resource: statement_timeout interrupts pg_sleep and the connection stays usable",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime({ statementTimeoutMs: 1_000 });

    try {
      try {
        // pg_sleep(3) far exceeds the 1s statement_timeout, so the server aborts it.
        await runtime.query(principal(USER_A), "select pg_sleep(3)");
        throw new Error("Expected statement_timeout to interrupt pg_sleep");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.postgresCode !== "57014"
        ) {
          throw error;
        }
      }

      // The reserved connection is reset (`discard all`) and released on failure,
      // so a subsequent query on a fresh checkout must succeed.
      const after = await runtime.query(principal(USER_A), "select 1 as ok");
      if (after.rows[0]?.ok !== 1) {
        throw new Error(
          `Expected connection to be reusable after timeout: ${JSON.stringify(after)}`,
        );
      }
    } finally {
      await runtime.close();
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database resource: lock_timeout (not statement_timeout) aborts a row-lock wait",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    // Second admin connection to hold a competing row lock open.
    const locker = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime({ lockTimeoutMs: 500, statementTimeoutMs: 5_000 });

    let lockerReserved: Awaited<ReturnType<typeof locker.reserve>> | null = null;

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.lockrow (
          id bigint primary key,
          v integer not null
        )
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant select, update on ${SCHEMA}.lockrow to authenticated`,
      );
      // RLS-permissive policy so the executor's authenticated role can lock/update.
      await admin.unsafe(
        `alter table ${SCHEMA}.lockrow enable row level security`,
      );
      await admin.unsafe(`
        create policy lockrow_all on ${SCHEMA}.lockrow
        for all to authenticated using (true) with check (true)
      `);
      await admin.unsafe(`insert into ${SCHEMA}.lockrow (id, v) values (1, 0)`);

      // Hold an exclusive lock on row id=1 in a separate open transaction.
      lockerReserved = await locker.reserve();
      await lockerReserved.unsafe("begin");
      await lockerReserved.unsafe(
        `select * from ${SCHEMA}.lockrow where id = 1 for update`,
      );

      const started = performance.now();
      try {
        // A query can't use `for update` (policy-rejected), so the runtime contends
        // via a mutation that must take a row lock on the same already-locked row.
        await runtime.mutate(
          principal(USER_A),
          `update ${SCHEMA}.lockrow set v = v where id = 1`,
        );
        throw new Error("Expected lock_timeout to abort the competing update");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.postgresCode !== "55P03"
        ) {
          throw error;
        }
      }
      const elapsed = performance.now() - started;
      // The abort must be driven by lock_timeout (500ms), not statement_timeout (5s).
      if (elapsed > 3_000) {
        throw new Error(
          `Expected lock_timeout (~500ms) to fire, but waited ${elapsed}ms`,
        );
      }
    } finally {
      if (lockerReserved) {
        await lockerReserved.unsafe("rollback");
        lockerReserved.release();
      }
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
      await locker.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database resource: advisory-lock contention is bounded by statement_timeout",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const holder = postgres(adminUrl!, { prepare: false, max: 1 });
    // statement_timeout < lock_timeout proves the advisory-lock wait ignores
    // lock_timeout and is bounded by statement_timeout instead.
    const runtime = createRuntime({ statementTimeoutMs: 1_000, lockTimeoutMs: 5_000 });

    let holderReserved: Awaited<ReturnType<typeof holder.reserve>> | null = null;

    try {
      // Hold transaction-scoped advisory lock 42 open in a separate transaction.
      holderReserved = await holder.reserve();
      await holderReserved.unsafe("begin");
      await holderReserved.unsafe("select pg_advisory_xact_lock(42)");

      const started = performance.now();
      try {
        await runtime.query(
          principal(USER_A),
          "select pg_advisory_xact_lock(42)",
        );
        throw new Error("Expected statement_timeout to bound the advisory-lock wait");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.postgresCode !== "57014"
        ) {
          throw error;
        }
      }
      const elapsed = performance.now() - started;
      // Bounded by statement_timeout (~1s); lock_timeout (5s) is ignored for
      // advisory-lock waits, so the abort must arrive well before 5s.
      if (elapsed > 3_000) {
        throw new Error(
          `Expected statement_timeout (~1s) to bound advisory wait, waited ${elapsed}ms`,
        );
      }
    } finally {
      if (holderReserved) {
        await holderReserved.unsafe("rollback");
        holderReserved.release();
      }
      await runtime.close();
      await holder.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database resource: F1 mutation RETURNING is capped at the database",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime({ maxRows: 10 });

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.items (
          id bigint generated always as identity primary key,
          body text not null
        )
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant select, insert on ${SCHEMA}.items to authenticated`,
      );
      await admin.unsafe(
        `grant usage, select on sequence ${SCHEMA}.items_id_seq to authenticated`,
      );

      const result = await runtime.mutate(
        principal(USER_A),
        `insert into ${SCHEMA}.items(body)
         select 'r' || g from generate_series(1, 50) g
         returning id, body`,
      );

      // 50 rows actually inserted (true affected count), only 10 returned to client.
      if (
        result.rowCount !== 50 ||
        result.rows.length !== 10 ||
        !result.truncated
      ) {
        throw new Error(
          `Expected DB-side RETURNING cap (50 affected, 10 returned): ${
            JSON.stringify({ ...result, rows: result.rows.length })
          }`,
        );
      }
      // The synthetic count column must never reach the client.
      if ("__agent_total" in (result.rows[0] ?? {})) {
        throw new Error("__agent_total leaked into returned rows");
      }
      // All 50 rows must be persisted despite the capped result.
      const [{ count }] = await admin.unsafe<{ count: string }[]>(
        `select count(*)::text as count from ${SCHEMA}.items`,
      );
      if (count !== "50") {
        throw new Error(`Expected all 50 rows persisted, got ${count}`);
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database resource: a single giant row is truncated with bounded client memory",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime({ maxResultBytes: 1_000 });

    try {
      const result = await runtime.query(
        principal(USER_A),
        "select repeat('x', 5000000) as payload",
      );
      if (result.rows.length !== 0 || !result.truncated) {
        throw new Error(
          `Expected giant row to be dropped + truncated: ${
            JSON.stringify({ rows: result.rows.length, truncated: result.truncated })
          }`,
        );
      }
    } finally {
      await runtime.close();
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database resource: F2 discard all clears a poisoned session GUC across requests",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    // maxConnections:1 forces the second request to reuse the same pooled
    // connection, making the connection-reset behavior deterministic to test.
    const runtime = createRuntime({}, { maxConnections: 1 });

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      // SECURITY INVOKER function that persists a SESSION-level GUC (is_local=false)
      // — it would survive commit on the pooled connection without a reset.
      await admin.unsafe(`
        create function ${SCHEMA}.poison()
        returns integer
        language plpgsql
        security invoker
        as $$
        begin
          perform set_config('app.tenant', 'evil', false);
          return 1;
        end;
        $$
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.poison() to authenticated`,
      );

      // Request 1: invoke poison() and commit. Without Fix 2 and with
      // maxConnections:1, the 'app.tenant' = 'evil' GUC would persist on this
      // connection and request 2 below would observe 'evil'.
      const poisoned = await runtime.query(
        principal(USER_A),
        `select ${SCHEMA}.poison() as p`,
      );
      if (poisoned.rows[0]?.p !== 1) {
        throw new Error(`Expected poison() to return 1: ${JSON.stringify(poisoned)}`);
      }

      // Request 2 (same pooled connection): the `discard all` on checkout must
      // have cleared the poisoned GUC, so current_setting returns null/empty.
      const observed = await runtime.query(
        principal(USER_A),
        "select current_setting('app.tenant', true) as v",
      );
      const v = observed.rows[0]?.v;
      if (v !== null && v !== "" && v !== undefined) {
        throw new Error(
          `Expected poisoned GUC to be cleared by discard all, observed ${JSON.stringify(v)}`,
        );
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});
