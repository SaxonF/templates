import { AgentSqlError } from "./errors.ts";
import { createSupabaseRlsAdapter } from "./adapters/supabase-rls.ts";
import type { TrustedTransaction } from "./types.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

const claims = {
  sub: "11111111-1111-4111-8111-111111111111",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3_600,
  client_id: "test-client",
};

function fakeTransaction(
  contextOverride: Record<string, unknown> = {},
  attestationOverride: Record<string, unknown> = {},
): TrustedTransaction {
  return {
    async query<Row>(sql: string): Promise<Row[]> {
      if (sql.includes("with recursive memberships")) {
        return [{
          session_user: "mcp_sql_executor",
          current_user: "mcp_sql_executor",
          rolcanlogin: true,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          memberships: ["authenticated"],
          has_owned_objects: false,
          server_version_num: 170_006,
          ...attestationOverride,
        }] as Row[];
      }
      if (sql.includes("auth.uid()::text")) {
        return [{
          session_user: "mcp_sql_executor",
          current_user: "authenticated",
          claims: JSON.stringify(claims),
          search_path: "public, extensions",
          uid: claims.sub,
          ...contextOverride,
        }] as Row[];
      }
      return [];
    },
  };
}

Deno.test("Supabase adapter installs and verifies an authenticated principal", async () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });
  const principal = { claims };
  adapter.validatePrincipal(principal);
  const transaction = fakeTransaction();
  const snapshot = await adapter.install(transaction, principal);
  await adapter.verify(transaction, principal, snapshot);
  assert(snapshot.uid === claims.sub);
});

Deno.test("Supabase adapter fails when the post-execution context changes", async () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });
  const principal = { claims };
  const snapshot = await adapter.install(fakeTransaction(), principal);
  try {
    await adapter.verify(
      fakeTransaction({ uid: "22222222-2222-4222-8222-222222222222" }),
      principal,
      snapshot,
    );
    throw new Error("Expected context verification to fail");
  } catch (error) {
    assert(error instanceof AgentSqlError);
    assert(error.code === "EXECUTION_CONTEXT_CHANGED");
  }
});

Deno.test("Supabase adapter rejects a privileged or connected executor", async () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });

  for (
    const override of [
      { rolcanlogin: false },
      { rolinherit: true },
      { rolsuper: true },
      { rolcreatedb: true },
      { rolcreaterole: true },
      { rolreplication: true },
      { rolbypassrls: true },
      { has_owned_objects: true },
      { memberships: ["authenticated", "service_role"] },
      { memberships: [] },
      { session_user: "postgres", current_user: "postgres" },
    ]
  ) {
    try {
      await adapter.install(fakeTransaction({}, override), { claims });
      throw new Error(
        `Expected attestation failure: ${JSON.stringify(override)}`,
      );
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(error.code === "EXECUTOR_ATTESTATION_FAILED");
    }
  }
});

Deno.test("Supabase adapter rejects unsupported database versions", async () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });

  for (const server_version_num of [140_000, 160_000, "180000"]) {
    try {
      await adapter.install(fakeTransaction({}, { server_version_num }), {
        claims,
      });
      throw new Error(
        `Expected version ${server_version_num} to be rejected`,
      );
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(error.code === "UNSUPPORTED_POSTGRES_VERSION");
    }
  }
});

Deno.test("Supabase adapter detects each protected context field changing", async () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });
  const principal = { claims };
  const snapshot = await adapter.install(fakeTransaction(), principal);

  for (
    const override of [
      { session_user: "postgres" },
      { current_user: "postgres" },
      { claims: JSON.stringify({ ...claims, sub: claims.sub }) + " " },
      { search_path: "public" },
      { uid: "22222222-2222-4222-8222-222222222222" },
    ]
  ) {
    try {
      await adapter.verify(fakeTransaction(override), principal, snapshot);
      throw new Error(
        `Expected context change to be rejected: ${JSON.stringify(override)}`,
      );
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(error.code === "EXECUTION_CONTEXT_CHANGED");
    }
  }
});

Deno.test("Supabase adapter rejects invalid principals before database access", () => {
  const adapter = createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });

  for (
    const invalidClaims of [
      { ...claims, sub: "not-a-uuid" },
      { ...claims, role: "service_role" },
      { ...claims, exp: 0 },
      { ...claims, exp: "not-a-number" },
      { ...claims, exp: Number.NaN },
      { ...claims, exp: Number.POSITIVE_INFINITY },
    ]
  ) {
    try {
      adapter.validatePrincipal({ claims: invalidClaims });
      throw new Error("Expected principal validation to fail");
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(error.code === "INVALID_PRINCIPAL");
    }
  }
});
