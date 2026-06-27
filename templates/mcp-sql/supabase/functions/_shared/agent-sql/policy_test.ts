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

Deno.test("policy rejects set_config reached through schema, quoting, and nesting", async () => {
  for (
    const sql of [
      // schema-qualified
      `select pg_catalog.set_config('request.jwt.claims', '{}', true)`,
      // quoted / cased identifier
      `select "set_config"('request.jwt.claims', '{}', true)`,
      `select "SET_CONFIG"('request.jwt.claims', '{}', true)`,
      // nested inside a CTE
      `with c as (select pg_catalog.set_config('x', 'y', true)) select * from c`,
      // nested inside a LATERAL subquery
      `select *
       from todos t,
       lateral (select set_config('x', 'y', true) as v) s`,
      // nested inside a scalar subquery
      `select (select set_config('x', 'y', true))`,
      // nested in a function-argument position
      `select coalesce(set_config('x', 'y', true), '')`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_FORBIDDEN_FUNCTION");
  }
});

Deno.test("policy accepts pg_sleep and advisory xact lock by design", async () => {
  // These PUBLIC functions are intentionally allowed; their bound is
  // statement_timeout (enforced by the runtime), not the AST policy. This test
  // encodes the product decision so any future change here is deliberate.
  for (
    const sql of [
      `select pg_sleep(1)`,
      `select pg_advisory_xact_lock(1)`,
    ]
  ) {
    const statement = await validateAgentSql(sql, "query", 65_536);
    assert(
      statement.kind === "select",
      `expected select kind for: ${sql}`,
    );
  }
});

Deno.test("query mode accepts SELECT-shaped statements and rejects writes", async () => {
  // VALUES and TABLE both parse to SelectStmt and are accepted as queries.
  for (
    const sql of [
      `values (1),(2)`,
      `table todos`,
    ]
  ) {
    const statement = await validateAgentSql(sql, "query", 65_536);
    assert(statement.kind === "select", `expected select for: ${sql}`);
    assert(statement.hasReturning === false);
  }

  // CREATE TABLE AS / SELECT INTO and temp/unlogged variants are not SELECTs.
  for (
    const sql of [
      `create table x as select 1`,
      `create temporary table x as select 1`,
      `create unlogged table x as select 1`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_MODE_VIOLATION");
  }
  // SELECT INTO (and temp/unlogged INTO) surface as a forbidden node.
  for (
    const sql of [
      `select 1 into y`,
      `select 1 into temporary y`,
      `select 1 into unlogged y`,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_FORBIDDEN_NODE");
  }

  // A DML CTE is still a write and is rejected in query mode.
  await assertRejected(
    `with a as (insert into todos(id) values (1) returning *) select * from a`,
    "query",
    "SQL_MODE_VIOLATION",
  );
});

Deno.test("mutation mode accepts every DML root including multi-table DML CTEs", async () => {
  for (
    const [sql, kind] of [
      [`insert into todos(id) values (1)`, "insert"],
      [`update todos set done = true where id = 1`, "update"],
      [`delete from todos where id = 1`, "delete"],
      [
        `merge into todos t using (values (1)) s(id) on t.id = s.id
         when matched then update set done = true`,
        "merge",
      ],
    ] as const
  ) {
    const statement = await validateAgentSql(sql, "mutation", 65_536);
    assert(statement.kind === kind, `expected ${kind} for: ${sql}`);
  }

  // A multi-table DML CTE (writing one table, inserting into another) is an
  // intentional, RLS-bounded capability in mutation mode.
  const statement = await validateAgentSql(
    `with a as (update other set x = 1 returning *)
     insert into mine select * from a`,
    "mutation",
    65_536,
  );
  assert(statement.kind === "insert");
});

Deno.test("policy computes hasReturning from the root RETURNING clause", async () => {
  for (
    const sql of [
      `insert into todos(id) values (1) returning id`,
      `update todos set done = true where id = 1 returning *`,
      `delete from todos where id = 1 returning id`,
    ]
  ) {
    const statement = await validateAgentSql(sql, "mutation", 65_536);
    assert(
      statement.hasReturning === true,
      `expected hasReturning true for: ${sql}`,
    );
  }

  const plainInsert = await validateAgentSql(
    `insert into todos(id) values (1)`,
    "mutation",
    65_536,
  );
  assert(plainInsert.hasReturning === false);

  const select = await validateAgentSql(`select 1`, "query", 65_536);
  assert(select.hasReturning === false);
});

Deno.test("policy extracts exactly one statement and resists piggybacking", async () => {
  // Semicolon inside a string literal does not split the statement.
  const literal = await validateAgentSql(`select ';' as a`, "query", 65_536);
  assert(literal.text === `select ';' as a`, `got: ${literal.text}`);

  // Semicolon inside a dollar-quoted body does not split the statement.
  const dollar = await validateAgentSql(
    `select $tag$a;b;c$tag$ as a`,
    "query",
    65_536,
  );
  assert(dollar.text === `select $tag$a;b;c$tag$ as a`, `got: ${dollar.text}`);

  // A trailing line comment stays attached to the single statement (Postgres
  // ignores it); crucially it is not split into a second statement.
  const comment = await validateAgentSql(
    `select 1 as a -- trailing comment`,
    "query",
    65_536,
  );
  assert(comment.kind === "select");
  assert(comment.text.startsWith(`select 1 as a`), `got: ${comment.text}`);
  assert(!comment.text.includes(";"));

  // Trailing whitespace (and a trailing semicolon) is trimmed.
  const trailing = await validateAgentSql(
    `select 1 as a;   \n\t  `,
    "query",
    65_536,
  );
  assert(trailing.text === `select 1 as a`, `got: ${trailing.text}`);
  assert(!trailing.text.endsWith(";"));

  // Two real statements are rejected as multiple statements.
  await assertRejected(`select 1; select 2`, "query", "SQL_MULTIPLE_STATEMENTS");
});

Deno.test("policy fails closed on malformed or unparseable SQL", async () => {
  for (
    const sql of [
      `select from`,
      `this is not sql at all`,
      `select 1 (((`,
      ``,
    ]
  ) {
    await assertRejected(sql, "query", "SQL_PARSE_ERROR");
  }
});

Deno.test("policy fails closed (no crash) on deeply nested expressions within the byte limit", async () => {
  // ~4 KB of left-associative additions — well within the 64 KB limit. This
  // must fail closed with SQL_PARSE_ERROR and never let a RangeError escape as
  // a misleading DATABASE_ERROR (covers the inspectAst depth guard and the
  // parser's own fail-closed behavior).
  const deepAddition = "select 1" + "+1".repeat(2_000);
  assert(new TextEncoder().encode(deepAddition).byteLength < 65_536);
  await assertRejected(deepAddition, "query", "SQL_PARSE_ERROR");

  // Thousands of nested parentheses, also within the byte limit, must not hang
  // or crash; they too fail closed as a parse error.
  const deepParens = "select " + "(".repeat(10_000) + "1" + ")".repeat(10_000);
  assert(new TextEncoder().encode(deepParens).byteLength < 65_536);
  await assertRejected(deepParens, "query", "SQL_PARSE_ERROR");
});
