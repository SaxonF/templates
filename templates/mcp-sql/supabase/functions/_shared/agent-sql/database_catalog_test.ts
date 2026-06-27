import postgres from "npm:postgres@3.4.7";

import {
  describeFunction,
  describeTable,
  listDatabaseObjects,
} from "./catalog.ts";
import {
  createSupabaseRlsAdapter,
  type SupabasePrincipal,
} from "./adapters/supabase-rls.ts";
import type { TrustedTransaction } from "./types.ts";

const adminUrl = Deno.env.get("AGENT_SQL_TEST_ADMIN_URL");
const executorUrl = Deno.env.get("AGENT_SQL_TEST_DATABASE_URL");
const enabled = Boolean(adminUrl && executorUrl);

const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const SCHEMA = "agent_sql_catalog_test";

// Mirror runtime.ts DEFAULT_EXCLUDED_SCHEMAS so the parity test exercises the
// real default surface plus the fixture schema. runtime.ts is owned by another
// workstream, so the list is duplicated here rather than imported.
const DEFAULT_EXCLUDED_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "auth",
  "storage",
  "realtime",
  "vault",
  "graphql",
  "graphql_public",
  "extensions",
  "net",
  "supabase_functions",
  "supabase_migrations",
  "pgbouncer",
  "cron",
  "pgsodium",
  "pgsodium_masks",
];

function principal(sub: string): SupabasePrincipal {
  return {
    claims: {
      sub,
      role: "authenticated",
      aud: ["authenticated"],
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  };
}

const adapter = createSupabaseRlsAdapter({
  loginRole: "mcp_sql_executor",
  databaseRole: "authenticated",
  searchPath: ["public", "extensions"],
});

type Sql = ReturnType<typeof postgres>;

function trustedTransaction(tx: unknown): TrustedTransaction {
  const sql = tx as Sql;
  return {
    async query<Row>(
      text: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      const result = await sql.unsafe(
        text,
        [...parameters] as never[],
      ) as unknown as Row[];
      return [...result];
    },
  };
}

// Runs `operation` inside a read-only transaction on the executor connection
// with the principal's RLS identity installed, exactly like the runtime's
// trustedRead path. This lets the catalog helpers be exercised directly against
// a real RLS-scoped session while we vary `excludedSchemas`.
async function withTrustedRead<T>(
  sql: Sql,
  who: SupabasePrincipal,
  operation: (transaction: TrustedTransaction) => Promise<T>,
): Promise<T> {
  return await sql.begin("read only", async (tx: unknown) => {
    const transaction = trustedTransaction(tx);
    const snapshot = await adapter.install(transaction, who);
    const result = await operation(transaction);
    await adapter.verify(transaction, who, snapshot);
    return result;
  }) as T;
}

Deno.test({
  name:
    "database catalog: describe respects excludedSchemas even when a privilege exists",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const executor = postgres(executorUrl!, { prepare: false, max: 2 });

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.granted (
          id bigint generated always as identity primary key,
          body text not null
        )
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant select on ${SCHEMA}.granted to authenticated`,
      );

      // Default excluded schemas (which do NOT contain the fixture schema):
      // the privilege exists, so the definition is returned.
      const visible = await withTrustedRead(
        executor,
        principal(USER_A),
        (transaction) =>
          describeTable(
            transaction,
            { schema: SCHEMA, table: "granted" },
            DEFAULT_EXCLUDED_SCHEMAS,
          ),
      );
      if (!visible || visible.name !== "granted" || visible.schema !== SCHEMA) {
        throw new Error(
          `Expected granted table to be describable with default exclusions: ${
            JSON.stringify(visible)
          }`,
        );
      }

      // Same privilege, but the fixture schema is now excluded: describe must
      // return null despite the held privilege (exclusion parity with list).
      const hidden = await withTrustedRead(
        executor,
        principal(USER_A),
        (transaction) =>
          describeTable(
            transaction,
            { schema: SCHEMA, table: "granted" },
            [SCHEMA, ...DEFAULT_EXCLUDED_SCHEMAS],
          ),
      );
      if (hidden !== null) {
        throw new Error(
          `Expected excluded schema describe to return null: ${
            JSON.stringify(hidden)
          }`,
        );
      }
    } finally {
      await executor.end({ timeout: 5 });
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name:
    "database catalog: ungranted table is absent from list and describe returns null",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const executor = postgres(executorUrl!, { prepare: false, max: 2 });

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create table ${SCHEMA}.granted (
          id bigint generated always as identity primary key,
          body text not null
        )
      `);
      await admin.unsafe(`
        create table ${SCHEMA}.secret (
          id bigint generated always as identity primary key,
          body text not null
        )
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      // Only "granted" is granted to authenticated; "secret" is not.
      await admin.unsafe(
        `grant select on ${SCHEMA}.granted to authenticated`,
      );

      const listed = await withTrustedRead(
        executor,
        principal(USER_B),
        (transaction) =>
          listDatabaseObjects(transaction, DEFAULT_EXCLUDED_SCHEMAS, {
            schema: SCHEMA,
            limit: 50,
          }),
      );
      const names = listed.objects.map((object) => object.name);
      if (!names.includes("granted")) {
        throw new Error(
          `Expected granted table in list: ${JSON.stringify(names)}`,
        );
      }
      if (names.includes("secret")) {
        throw new Error(
          `Ungranted table leaked into list: ${JSON.stringify(names)}`,
        );
      }

      const secret = await withTrustedRead(
        executor,
        principal(USER_B),
        (transaction) =>
          describeTable(
            transaction,
            { schema: SCHEMA, table: "secret" },
            DEFAULT_EXCLUDED_SCHEMAS,
          ),
      );
      if (secret !== null) {
        throw new Error(
          `Expected ungranted table describe to return null: ${
            JSON.stringify(secret)
          }`,
        );
      }
    } finally {
      await executor.end({ timeout: 5 });
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name:
    "database catalog: describeFunction respects excludedSchemas even when execute is granted",
  ignore: !enabled,
  async fn() {
    const admin = postgres(adminUrl!, { prepare: false, max: 1 });
    const executor = postgres(executorUrl!, { prepare: false, max: 2 });

    try {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.unsafe(`create schema ${SCHEMA}`);
      await admin.unsafe(`
        create function ${SCHEMA}.echo(value integer)
        returns integer
        language sql
        immutable
        as $$ select value $$
      `);
      await admin.unsafe(`grant usage on schema ${SCHEMA} to authenticated`);
      await admin.unsafe(
        `grant execute on function ${SCHEMA}.echo(integer) to authenticated`,
      );

      // Default exclusions do not include the fixture schema: execute privilege
      // is held, so the definition is surfaced.
      const visible = await withTrustedRead(
        executor,
        principal(USER_A),
        (transaction) =>
          describeFunction(
            transaction,
            { schema: SCHEMA, name: "echo" },
            DEFAULT_EXCLUDED_SCHEMAS,
          ),
      );
      if (
        visible.length !== 1 ||
        visible[0].name !== "echo" ||
        visible[0].schema !== SCHEMA
      ) {
        throw new Error(
          `Expected granted function to be describable: ${
            JSON.stringify(visible)
          }`,
        );
      }

      // Excluding the fixture schema hides the function despite the privilege.
      const hidden = await withTrustedRead(
        executor,
        principal(USER_A),
        (transaction) =>
          describeFunction(
            transaction,
            { schema: SCHEMA, name: "echo" },
            [SCHEMA, ...DEFAULT_EXCLUDED_SCHEMAS],
          ),
      );
      if (hidden.length !== 0) {
        throw new Error(
          `Expected excluded schema function describe to be empty: ${
            JSON.stringify(hidden)
          }`,
        );
      }
    } finally {
      await executor.end({ timeout: 5 });
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
      await admin.end({ timeout: 5 });
    }
  },
});
