import { AgentSqlError } from "./errors.ts";
import { boundedRows, createAgentSqlRuntime, mutationText, queryText } from "./runtime.ts";
import { DEFAULT_RUNTIME_LIMITS } from "./types.ts";
import type {
  IdentityContextAdapter,
  RuntimeLimits,
  ValidatedStatement,
} from "./types.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Expected ${expectedJson}, got ${actualJson}`);
  }
}

function limits(overrides: Partial<RuntimeLimits> = {}): RuntimeLimits {
  return { ...DEFAULT_RUNTIME_LIMITS, ...overrides };
}

function rowBytes(row: Record<string, unknown>): number {
  // Mirrors boundedRows' per-row accounting (JSON byte length + 1 separator).
  return new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
}

function statement(text: string, hasReturning = true): ValidatedStatement {
  return {
    kind: "insert",
    text,
    parserVersion: 17_0000,
    hasReturning,
  };
}

// A minimal identity adapter; createAgentSqlRuntime never reaches install/verify
// in these tests because validateLimits throws (or never connects — the pool is lazy).
const stubAdapter: IdentityContextAdapter<{ id: string }, null> = {
  validatePrincipal() {},
  install() {
    return Promise.resolve(null);
  },
  verify() {
    return Promise.resolve();
  },
};

Deno.test("boundedRows: first row already over maxResultBytes yields zero rows + truncated", () => {
  const big = { payload: "x".repeat(10_000) };
  const result = boundedRows([big], limits({ maxResultBytes: 50, maxRows: 100 }));
  assertEquals(result.rows.length, 0);
  assertEquals(result.truncated, true);
});

Deno.test("boundedRows: exact-byte boundary includes the row, one byte less excludes it", () => {
  const row = { a: 1 };
  // boundedRows seeds the byte counter at 2 (the surrounding "[]" array brackets).
  const exact = 2 + rowBytes(row);

  const fits = boundedRows([row], limits({ maxResultBytes: exact, maxRows: 100 }));
  assertEquals(fits.rows.length, 1);
  assertEquals(fits.truncated, false);

  const justUnder = boundedRows(
    [row],
    limits({ maxResultBytes: exact - 1, maxRows: 100 }),
  );
  assertEquals(justUnder.rows.length, 0);
  assertEquals(justUnder.truncated, true);
});

Deno.test("boundedRows: maxRows slicing and truncated flag", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ i }));

  const sliced = boundedRows(rows, limits({ maxRows: 3, maxResultBytes: 1_000_000 }));
  assertEquals(sliced.rows.length, 3);
  assertEquals(sliced.truncated, true);
  assertEquals(sliced.rows.map((r) => r.i), [0, 1, 2]);

  const allFit = boundedRows(rows, limits({ maxRows: 5, maxResultBytes: 1_000_000 }));
  assertEquals(allFit.rows.length, 5);
  assertEquals(allFit.truncated, false);

  const empty = boundedRows([], limits({ maxRows: 5, maxResultBytes: 1_000_000 }));
  assertEquals(empty.rows.length, 0);
  assertEquals(empty.truncated, false);
});

Deno.test("queryText wraps a SELECT with limit maxRows + 1", () => {
  const text = queryText(statement("select 1", false), 10);
  assert(text.includes("select 1"), "inner statement preserved");
  assert(text.includes('as "__agent_query"'), "wrapped subquery alias present");
  assert(text.includes("limit 11"), `expected limit maxRows+1, got: ${text}`);
});

Deno.test("mutationText wraps a mutation with the count window and limit maxRows + 1", () => {
  const inner =
    "insert into items(body) select 'r' from generate_series(1, 50) returning id";
  const text = mutationText(statement(inner), 10);
  assert(text.includes("with __agent_mutation as"), "CTE wrapper present");
  assert(text.includes(inner), "inner mutation preserved verbatim");
  assert(
    text.includes("count(*) over () as __agent_total"),
    `expected total window column, got: ${text}`,
  );
  assert(text.includes("from __agent_mutation"), "selects from the CTE");
  assert(text.includes("limit 11"), `expected limit maxRows+1, got: ${text}`);
});

Deno.test("createAgentSqlRuntime rejects non-positive maxRows with CONFIGURATION_ERROR", () => {
  let thrown: unknown;
  try {
    // The pool is lazy, so no DB connection is opened: validateLimits throws first.
    createAgentSqlRuntime({
      databaseUrl: "postgresql://x",
      identity: stubAdapter,
      limits: { maxRows: 0 },
    });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof AgentSqlError, `expected AgentSqlError, got ${String(thrown)}`);
  assertEquals((thrown as AgentSqlError).code, "CONFIGURATION_ERROR");
});
