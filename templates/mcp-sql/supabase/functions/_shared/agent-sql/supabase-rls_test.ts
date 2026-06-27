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

/**
 * A fake transaction that records every (sql, parameters) pair it receives and
 * echoes back the exact claims string that `install` asked it to set, so the
 * post-install context assertion still passes. This lets tests inspect the
 * literal value handed to `set_config('request.jwt.claims', ...)`.
 */
function recordingTransaction(claimsJson: () => string): {
  transaction: TrustedTransaction;
  calls: Array<{ sql: string; parameters: readonly unknown[] }>;
} {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const transaction: TrustedTransaction = {
    async query<Row>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      calls.push({ sql, parameters });
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
        }] as Row[];
      }
      if (sql.includes("auth.uid()::text")) {
        // Echo the exact claims string install installed so assertContext passes.
        return [{
          session_user: "mcp_sql_executor",
          current_user: "authenticated",
          claims: claimsJson(),
          search_path: "public, extensions",
          uid: claims.sub,
        }] as Row[];
      }
      return [];
    },
  };
  return { transaction, calls };
}

function newAdapter() {
  return createSupabaseRlsAdapter({
    loginRole: "mcp_sql_executor",
    databaseRole: "authenticated",
    searchPath: ["public", "extensions"],
  });
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

Deno.test("Supabase adapter accepts a principal whose claims omit exp entirely", () => {
  const adapter = newAdapter();
  // `exp` is undefined here; the adapter treats a missing expiry as acceptable
  // (JWT verification upstream is responsible for expiry — this is belt-and-
  // suspenders for the `exp` that IS present).
  const noExp: Record<string, unknown> = {
    sub: claims.sub,
    role: "authenticated",
  };
  assert(!("exp" in noExp));
  // Must not throw.
  adapter.validatePrincipal({ claims: noExp });
});

Deno.test("Supabase adapter rejects a principal whose exp is exactly now (exp <= now)", () => {
  const adapter = newAdapter();
  const now = Math.floor(Date.now() / 1000);
  try {
    adapter.validatePrincipal({
      claims: { sub: claims.sub, role: "authenticated", exp: now },
    });
    throw new Error("Expected an exp of exactly now to be rejected");
  } catch (error) {
    assert(error instanceof AgentSqlError);
    assert(error.code === "INVALID_PRINCIPAL");
  }
});

Deno.test("Supabase adapter rejects principals with a wrong role, non-UUID sub, or non-object claims", () => {
  const adapter = newAdapter();

  const cases: unknown[] = [
    // role must be exactly "authenticated".
    { sub: claims.sub, role: "anon", exp: claims.exp },
    { sub: claims.sub, role: "service_role", exp: claims.exp },
    // sub must be a UUID.
    { sub: "not-a-uuid", role: "authenticated", exp: claims.exp },
    { sub: 12345, role: "authenticated", exp: claims.exp },
    // claims must be a non-null, non-array object.
    null,
    undefined,
    [{ sub: claims.sub, role: "authenticated" }],
    "a string",
    42,
  ];

  for (const invalidClaims of cases) {
    try {
      adapter.validatePrincipal({ claims: invalidClaims as never });
      throw new Error(
        `Expected principal validation to fail: ${JSON.stringify(invalidClaims)}`,
      );
    } catch (error) {
      assert(error instanceof AgentSqlError);
      assert(
        error.code === "INVALID_PRINCIPAL",
        `Expected INVALID_PRINCIPAL, got ${
          (error as AgentSqlError).code
        } for ${JSON.stringify(invalidClaims)}`,
      );
    }
  }
});

Deno.test("Supabase adapter preserves extra/custom claims verbatim in the installed request.jwt.claims", async () => {
  const adapter = newAdapter();
  const customClaims = {
    sub: claims.sub,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3_600,
    app_metadata: { provider: "email", tenant: "acme" },
    tenant_id: "tenant-42",
    user_metadata: { name: "Ada" },
  };
  const expectedClaimsJson = JSON.stringify(customClaims);

  const { transaction, calls } = recordingTransaction(() => expectedClaimsJson);
  const snapshot = await adapter.install(transaction, { claims: customClaims });

  // The snapshot the runtime re-verifies against must carry the exact string.
  assert(snapshot.claimsJson === expectedClaimsJson);

  // Find the set_config('request.jwt.claims', $1, true) call and inspect $1.
  const claimsCall = calls.find((call) =>
    call.sql.includes("request.jwt.claims")
  );
  assert(claimsCall, "Expected install to call set_config(request.jwt.claims)");
  const installedClaims = claimsCall.parameters[0];
  assert(typeof installedClaims === "string");

  // The literal value handed to set_config must contain every custom claim verbatim.
  assert(installedClaims === expectedClaimsJson);
  assert(installedClaims.includes(`"tenant_id":"tenant-42"`));
  assert(installedClaims.includes(`"app_metadata":{"provider":"email"`));
  assert(installedClaims.includes(`"tenant":"acme"`));
  assert(installedClaims.includes(`"user_metadata":{"name":"Ada"}`));
});
