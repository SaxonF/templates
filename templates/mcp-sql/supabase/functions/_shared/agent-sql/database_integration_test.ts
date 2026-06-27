import postgres from "npm:postgres@3.4.7";

import { createSupabaseRlsAdapter } from "./adapters/supabase-rls.ts";
import { AgentSqlError } from "./errors.ts";
import { createAgentSqlRuntime } from "./runtime.ts";

const adminUrl = Deno.env.get("AGENT_SQL_TEST_ADMIN_URL");
const executorUrl = Deno.env.get("AGENT_SQL_TEST_DATABASE_URL");
const enabled = Boolean(adminUrl && executorUrl);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCHEMA = "agent_sql_validation";

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

function createRuntime(limits = {}) {
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
  });
}

Deno.test({
  name: "database integration: runtime preserves two-user RLS isolation",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime();

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.notes (
          id bigint generated always as identity primary key,
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
        `grant select, insert, update, delete on ${SCHEMA}.notes to authenticated`,
      );
      await admin.unsafe(
        `grant usage, select on sequence ${SCHEMA}.notes_id_seq to authenticated`,
      );
      await admin.unsafe(
        `insert into ${SCHEMA}.notes (user_id, body) values ($1, 'user-a'), ($2, 'user-b')`,
        [USER_A, USER_B],
      );

      const resultA = await runtime.query(
        principal(USER_A),
        `select auth.uid()::text as uid, body from ${SCHEMA}.notes order by id`,
      );
      const resultB = await runtime.query(
        principal(USER_B),
        `select auth.uid()::text as uid, body from ${SCHEMA}.notes order by id`,
      );

      if (
        resultA.rows.length !== 1 ||
        resultA.rows[0].uid !== USER_A ||
        resultA.rows[0].body !== "user-a"
      ) {
        throw new Error(`Unexpected user A result: ${JSON.stringify(resultA)}`);
      }
      if (
        resultB.rows.length !== 1 ||
        resultB.rows[0].uid !== USER_B ||
        resultB.rows[0].body !== "user-b"
      ) {
        throw new Error(`Unexpected user B result: ${JSON.stringify(resultB)}`);
      }

      const forbiddenUpdate = await runtime.mutate(
        principal(USER_A),
        `update ${SCHEMA}.notes set body = 'stolen' where user_id = '${USER_B}' returning id`,
      );
      if (forbiddenUpdate.rowCount !== 0 || forbiddenUpdate.rows.length !== 0) {
        throw new Error("RLS allowed user A to update user B's row.");
      }

      const ownUpdate = await runtime.mutate(
        principal(USER_A),
        `update ${SCHEMA}.notes set body = 'updated-a' where user_id = '${USER_A}' returning body`,
      );
      if (
        ownUpdate.rowCount !== 1 || ownUpdate.rows[0]?.body !== "updated-a"
      ) {
        throw new Error(
          `Unexpected own-row mutation: ${JSON.stringify(ownUpdate)}`,
        );
      }

      try {
        await runtime.query(
          principal(USER_A),
          `select set_config('request.jwt.claims', '{"sub":"${USER_B}"}', true)`,
        );
        throw new Error("set_config unexpectedly passed SQL policy.");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.code !== "SQL_FORBIDDEN_FUNCTION"
        ) {
          throw error;
        }
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "database integration: runtime bounds query and mutation results",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime({ maxRows: 2, maxResultBytes: 80 });

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
      await admin.unsafe(
        `insert into ${SCHEMA}.items (body) values ('a'), ('b'), ('c')`,
      );

      const queryResult = await runtime.query(
        principal(USER_A),
        `select id, body from ${SCHEMA}.items order by id`,
      );
      if (
        queryResult.rowCount !== 2 ||
        queryResult.rows.length !== 2 ||
        !queryResult.truncated
      ) {
        throw new Error(
          `Expected query rows to be truncated: ${JSON.stringify(queryResult)}`,
        );
      }

      const byteResult = await runtime.query(
        principal(USER_A),
        `select repeat('x', 200) as payload`,
      );
      if (byteResult.rows.length !== 0 || !byteResult.truncated) {
        throw new Error(
          `Expected oversized row to be truncated: ${
            JSON.stringify(byteResult)
          }`,
        );
      }

      const mutationResult = await runtime.mutate(
        principal(USER_A),
        `insert into ${SCHEMA}.items (body)
         select 'returned-' || n::text from generate_series(1, 3) n
         returning id, body`,
      );
      if (
        mutationResult.rowCount !== 3 ||
        mutationResult.rows.length !== 2 ||
        !mutationResult.truncated
      ) {
        throw new Error(
          `Expected mutation returning rows to be bounded: ${
            JSON.stringify(mutationResult)
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

Deno.test({
  name:
    "database integration: runtime verifies hidden context tampering and rolls back",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime();

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.notes (
          id bigint generated always as identity primary key,
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
        `grant select, insert, update on ${SCHEMA}.notes to authenticated`,
      );
      await admin.unsafe(
        `grant usage, select on sequence ${SCHEMA}.notes_id_seq to authenticated`,
      );
      await admin.unsafe(`
        create function ${SCHEMA}.tamper_claims()
        returns integer
        language plpgsql
        as $$
        begin
          perform set_config(
            'request.jwt.claims',
            '{"sub":"${USER_B}","role":"authenticated"}',
            true
          );
          return 1;
        end;
        $$
      `);
      await admin.unsafe(`
        create function ${SCHEMA}.tamper_claims_trigger()
        returns trigger
        language plpgsql
        as $$
        begin
          perform set_config(
            'request.jwt.claims',
            '{"sub":"${USER_B}","role":"authenticated"}',
            true
          );
          return new;
        end;
        $$
      `);
      await admin.unsafe(`
        create trigger notes_tamper_claims
        before update on ${SCHEMA}.notes
        for each row execute function ${SCHEMA}.tamper_claims_trigger()
      `);
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.tamper_claims() to authenticated`,
      );
      await admin.unsafe(
        `insert into ${SCHEMA}.notes (user_id, body) values ($1, 'original')`,
        [USER_A],
      );

      try {
        await runtime.query(
          principal(USER_A),
          `select ${SCHEMA}.tamper_claims()`,
        );
        throw new Error("Expected hidden query context tampering to fail");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.code !== "EXECUTION_CONTEXT_CHANGED"
        ) {
          throw error;
        }
      }

      try {
        await runtime.mutate(
          principal(USER_A),
          `update ${SCHEMA}.notes
           set body = 'tampered'
           where user_id = '${USER_A}'
           returning body`,
        );
        throw new Error("Expected hidden mutation context tampering to fail");
      } catch (error) {
        // The BEFORE UPDATE trigger swaps claims to USER_B, so PostgreSQL
        // evaluates the RLS WITH CHECK policy with the tampered identity and
        // rejects the write ("new row violates row-level security policy")
        // BEFORE the post-statement verify() runs. So the tamper is caught
        // either by RLS itself (DATABASE_ERROR) or, if it ever slipped past the
        // write, by verify() (EXECUTION_CONTEXT_CHANGED). Both block the write;
        // the rollback assertion below is the real guarantee.
        if (
          !(error instanceof AgentSqlError) ||
          (error.code !== "EXECUTION_CONTEXT_CHANGED" &&
            error.code !== "DATABASE_ERROR")
        ) {
          throw error;
        }
      }

      const rows = await admin.unsafe<{ body: string }[]>(
        `select body from ${SCHEMA}.notes where user_id = $1`,
        [USER_A],
      );
      if (rows[0]?.body !== "original") {
        throw new Error(
          `Expected failed mutation to roll back: ${JSON.stringify(rows)}`,
        );
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name:
    "database integration: read-only query transaction rejects hidden writes",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const runtime = createRuntime();

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.side_effects (
          id bigint generated always as identity primary key,
          body text not null
        )
      `);
      await admin.unsafe(`
        create function ${SCHEMA}.write_side_effect()
        returns integer
        language plpgsql
        as $$
        begin
          insert into ${SCHEMA}.side_effects(body) values ('written');
          return 1;
        end;
        $$
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant select, insert on ${SCHEMA}.side_effects to authenticated`,
      );
      await admin.unsafe(
        `grant usage, select on sequence ${SCHEMA}.side_effects_id_seq to authenticated`,
      );
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.write_side_effect() to authenticated`,
      );

      try {
        await runtime.query(
          principal(USER_A),
          `select ${SCHEMA}.write_side_effect()`,
        );
        throw new Error("Expected read-only transaction to reject write");
      } catch (error) {
        if (
          !(error instanceof AgentSqlError) ||
          error.code !== "DATABASE_ERROR"
        ) {
          throw error;
        }
      }

      const rows = await admin.unsafe<{ count: string }[]>(
        `select count(*) from ${SCHEMA}.side_effects`,
      );
      if (rows[0]?.count !== "0") {
        throw new Error(
          `Expected hidden write to be rolled back: ${JSON.stringify(rows)}`,
        );
      }
    } finally {
      await runtime.close();
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});
