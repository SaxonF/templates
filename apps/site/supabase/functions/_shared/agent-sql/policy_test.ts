import { AgentSqlError } from "./errors.ts";
import { validateAgentSql } from "./policy.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejected(
  sql: string,
  mode: "query" | "mutation",
  code: string,
  maxSqlBytes = 65_536,
) {
  try {
    await validateAgentSql(sql, mode, maxSqlBytes);
    throw new Error(`Expected ${code} for: ${sql}`);
  } catch (error) {
    assert(
      error instanceof AgentSqlError,
      `Expected AgentSqlError, got ${String(error)}`,
    );
    assert(error.code === code, `Expected ${code}, got ${error.code}`);
  }
}

Deno.test("query policy accepts expressive SELECT statements", async () => {
  const statement = await validateAgentSql(
    `with recursive ids as (
       select 1 as id union all select id + 1 from ids where id < 3
     )
     select id, count(*) over () from ids order by id;`,
    "query",
    65_536,
  );
  assert(statement.kind === "select");
  assert(!statement.text.endsWith(";"));
});

Deno.test("mutation policy accepts each DML root", async () => {
  for (
    const [sql, kind] of [
      [`insert into todos(id) values (1) returning id`, "insert"],
      [`update todos set done = true where id = 1 returning id`, "update"],
      [`delete from todos where id = 1 returning id`, "delete"],
      [
        `merge into todos t using (values (1)) s(id) on t.id = s.id
      when matched then update set done = true`,
        "merge",
      ],
    ] as const
  ) {
    const statement = await validateAgentSql(sql, "mutation", 65_536);
    assert(statement.kind === kind);
  }
});

Deno.test("policy rejects the single-statement JWT claim spoof", async () => {
  await assertRejected(
    `with changed as materialized (
       select pg_catalog.set_config(
         'request.jwt.claims',
         '{"sub":"22222222-2222-4222-8222-222222222222"}',
         true
       )
     )
     select auth.uid() from changed`,
    "query",
    "SQL_FORBIDDEN_FUNCTION",
  );
});

Deno.test("policy rejects forbidden functions through aliases and nesting", async () => {
  for (
    const sql of [
      `select pg_catalog.set_config('request.jwt.claims', '{}', true)`,
      `select "set_config"('request.jwt.claims', '{}', true)`,
      `select coalesce(pg_notify('agent', 'external side effect'), '')`,
      `select *
       from lateral (
         select pg_try_advisory_lock(1) as locked
       ) locks`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_FORBIDDEN_FUNCTION");
  }
});

Deno.test("policy rejects utility, procedural, DDL, and multi-statement SQL", async () => {
  for (
    const [sql, mode] of [
      [`set local request.jwt.claims = '{}'`, "query"],
      [`do $$ begin perform 1; end $$`, "query"],
      [`call public.do_work()`, "mutation"],
      [`create table bad(id int)`, "mutation"],
      [`explain select 1`, "query"],
      [`copy todos to stdout`, "query"],
      [`listen agent_events`, "query"],
      [`prepare agent_statement as select 1`, "query"],
      [`execute agent_statement`, "query"],
      [`begin transaction`, "query"],
      [`commit`, "query"],
    ] as const
  ) {
    await assertRejected(sql, mode, "SQL_MODE_VIOLATION");
  }
  await assertRejected(
    `select 1; select 2`,
    "query",
    "SQL_MULTIPLE_STATEMENTS",
  );
});

Deno.test("query policy rejects hidden writes and persistent locks", async () => {
  await assertRejected(
    `select * into temporary x from todos`,
    "query",
    "SQL_FORBIDDEN_NODE",
  );
  await assertRejected(
    `select * from todos for update`,
    "query",
    "SQL_FORBIDDEN_NODE",
  );
  for (
    const sql of [
      `select * from todos for share`,
      `select * from todos for no key update skip locked`,
      `select * from todos for key share nowait`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_FORBIDDEN_NODE");
  }
  for (
    const sql of [
      `with changed as (insert into todos(id) values (1) returning *) select * from changed`,
      `with changed as (update todos set done = true returning *) select * from changed`,
      `with changed as (delete from todos returning *) select * from changed`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_MODE_VIOLATION");
  }
  await assertRejected(
    `select pg_advisory_lock(1)`,
    "query",
    "SQL_FORBIDDEN_FUNCTION",
  );
  await assertRejected(
    `select pg_notify('agent', 'external side effect')`,
    "query",
    "SQL_FORBIDDEN_FUNCTION",
  );
});

Deno.test("policy measures UTF-8 bytes and preserves semicolons in literals", async () => {
  const statement = await validateAgentSql(
    `select ';' as value; -- trailing`,
    "query",
    65_536,
  );
  assert(statement.text.includes(`select ';' as value`));
  await assertRejected(
    `select '${"é".repeat(40)}'`,
    "query",
    "SQL_TOO_LARGE",
    30,
  );
});
