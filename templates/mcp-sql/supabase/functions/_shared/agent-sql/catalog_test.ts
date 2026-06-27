import {
  describeFunction,
  describeTable,
  listDatabaseObjects,
} from "./catalog.ts";
import { AgentSqlError } from "./errors.ts";
import type { TrustedTransaction } from "./types.ts";

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
    throw new Error(
      message ??
        `Expected ${expectedJson}, got ${actualJson}`,
    );
  }
}

type RecordedQuery = {
  text: string;
  parameters: readonly unknown[];
};

function fakeTransaction<Row>(
  rows: Row[],
  queries: RecordedQuery[] = [],
): TrustedTransaction {
  return {
    async query<T>(
      text: string,
      parameters: readonly unknown[] = [],
    ): Promise<T[]> {
      queries.push({ text, parameters });
      return rows as unknown as T[];
    },
  };
}

Deno.test("catalog list validates limits and cursor shape", async () => {
  const transaction = fakeTransaction([]);

  for (const limit of [0, 101, 1.5]) {
    try {
      await listDatabaseObjects(transaction, [], { limit });
      throw new Error(`Expected limit ${limit} to be rejected`);
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(error.code === "CONFIGURATION_ERROR");
    }
  }

  try {
    await listDatabaseObjects(transaction, [], { cursor: "not-base64-json" });
    throw new Error("Expected invalid cursor to be rejected");
  } catch (error) {
    assert(error instanceof AgentSqlError);
    assert(error.code === "SQL_PARSE_ERROR");
  }
});

Deno.test("catalog list maps rows and carries a tamper-resistant cursor", async () => {
  const firstQueries: RecordedQuery[] = [];
  const first = await listDatabaseObjects(
    fakeTransaction([
      {
        kind: "relation",
        schema: "public",
        name: "todos",
        identity: "",
        relation_kind: "table",
        arguments: null,
        returns: null,
        volatility: null,
        security: null,
      },
      {
        kind: "function",
        schema: "public",
        name: "do_work",
        identity: "id bigint",
        relation_kind: null,
        arguments: "id bigint",
        returns: "void",
        volatility: "volatile",
        security: "definer",
      },
    ], firstQueries),
    ["pg_catalog"],
    { schema: "public", limit: 1 },
  );

  assertEquals(first.objects, [{
    kind: "relation",
    schema: "public",
    name: "todos",
    relationKind: "table",
  }]);
  assert(typeof first.nextCursor === "string");
  assertEquals(firstQueries[0].parameters.slice(0, 3), [
    ["pg_catalog"],
    "public",
    null,
  ]);

  const secondQueries: RecordedQuery[] = [];
  await listDatabaseObjects(
    fakeTransaction([], secondQueries),
    ["pg_catalog"],
    { cursor: first.nextCursor!, limit: 10 },
  );

  assertEquals(secondQueries[0].parameters.slice(3, 7), [
    "relation",
    "public",
    "todos",
    "",
  ]);
});

Deno.test("catalog describe helpers default schema and return definitions", async () => {
  const tableQueries: RecordedQuery[] = [];
  const table = await describeTable(
    fakeTransaction(
      [{ definition: { schema: "public", name: "todos" } }],
      tableQueries,
    ),
    { table: "todos" },
  );
  assertEquals(table, { schema: "public", name: "todos" });
  assertEquals(tableQueries[0].parameters, ["public", "todos", []]);

  const functionQueries: RecordedQuery[] = [];
  const functions = await describeFunction(
    fakeTransaction([{
      definitions: [{
        schema: "private",
        name: "do_work",
        security: "definer",
        security_warning:
          "This function runs with its owner privileges; review it before agent use.",
      }],
    }], functionQueries),
    { schema: "private", name: "do_work" },
  );
  assertEquals(functions, [{
    schema: "private",
    name: "do_work",
    security: "definer",
    security_warning:
      "This function runs with its owner privileges; review it before agent use.",
  }]);
  assertEquals(functionQueries[0].parameters, ["private", "do_work", []]);
});

Deno.test("catalog describe helpers forward excluded schemas as a query parameter", async () => {
  const tableQueries: RecordedQuery[] = [];
  const table = await describeTable(
    fakeTransaction<{ definition: unknown }>([], tableQueries),
    { table: "users", schema: "auth" },
    ["auth"],
  );
  assertEquals(table, null);
  assertEquals(tableQueries[0].parameters, ["auth", "users", ["auth"]]);

  const functionQueries: RecordedQuery[] = [];
  const functions = await describeFunction(
    fakeTransaction<{ definitions: unknown[] }>([], functionQueries),
    { name: "uid", schema: "auth" },
    ["auth"],
  );
  assertEquals(functions, []);
  assertEquals(functionQueries[0].parameters, ["auth", "uid", ["auth"]]);
});
