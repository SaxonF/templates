import { AgentSqlError } from "../errors.ts";
import type {
  IdentityContextAdapter,
  JsonObject,
  TrustedTransaction,
} from "../types.ts";

export type SupabasePrincipal = {
  claims: JsonObject;
};

export type SupabaseRlsSnapshot = {
  sessionUser: string;
  currentUser: string;
  claimsJson: string;
  searchPath: string;
  uid: string;
};

export type SupabaseRlsAdapterOptions = {
  loginRole: string;
  databaseRole: string;
  searchPath: string[];
};

type AttestationRow = {
  session_user: string;
  current_user: string;
  rolcanlogin: boolean;
  rolinherit: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  memberships: string[] | null;
  has_owned_objects: boolean;
  server_version_num: number | string;
};

type ContextRow = {
  session_user: string;
  current_user: string;
  claims: string | null;
  search_path: string | null;
  uid: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ATTEST_SQL = `
with recursive memberships(role_oid, role_name) as (
  select r.oid, r.rolname
  from pg_roles r
  where r.rolname = session_user

  union

  select parent.oid, parent.rolname
  from memberships child
  join pg_auth_members membership on membership.member = child.role_oid
  join pg_roles parent on parent.oid = membership.roleid
), owned_objects as (
  -- pg_shdepend is PostgreSQL's complete cross-catalog ownership index. Using
  -- it avoids an allow-list that could miss operators, extensions, foreign
  -- servers, publications, or object kinds added by a newer PostgreSQL.
  select 1
  from pg_shdepend dependency
  where dependency.refclassid = 'pg_authid'::regclass
    and dependency.refobjid = (
      select oid from pg_roles where rolname = session_user
    )
    and dependency.deptype = 'o'
)
select
  session_user::text as session_user,
  current_user::text as current_user,
  role.rolcanlogin,
  role.rolinherit,
  role.rolsuper,
  role.rolcreatedb,
  role.rolcreaterole,
  role.rolreplication,
  role.rolbypassrls,
  coalesce(
    (select array_agg(role_name::text order by role_name::text)
     from memberships where role_name <> session_user),
    array[]::text[]
  ) as memberships,
  exists(select 1 from owned_objects) as has_owned_objects,
  current_setting('server_version_num')::integer as server_version_num
from pg_roles role
where role.rolname = session_user
`;

const CONTEXT_SQL = `
select
  session_user::text as session_user,
  current_user::text as current_user,
  current_setting('request.jwt.claims', true) as claims,
  current_setting('search_path', true) as search_path,
  auth.uid()::text as uid
`;

function principalClaims(principal: SupabasePrincipal): {
  claimsJson: string;
  uid: string;
} {
  const claims = principal?.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new AgentSqlError(
      "INVALID_PRINCIPAL",
      "Verified JWT claims are required.",
    );
  }

  const uid = claims.sub;
  if (typeof uid !== "string" || !UUID_PATTERN.test(uid)) {
    throw new AgentSqlError(
      "INVALID_PRINCIPAL",
      "The JWT subject must be a UUID.",
    );
  }
  if (claims.role !== "authenticated") {
    throw new AgentSqlError(
      "INVALID_PRINCIPAL",
      "An authenticated user JWT is required.",
    );
  }
  if (
    claims.exp !== undefined &&
    (typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000))
  ) {
    throw new AgentSqlError(
      "INVALID_PRINCIPAL",
      "The JWT is expired or has an invalid expiry.",
    );
  }

  try {
    return { claimsJson: JSON.stringify(claims), uid };
  } catch {
    throw new AgentSqlError(
      "INVALID_PRINCIPAL",
      "JWT claims are not JSON serializable.",
    );
  }
}

function assertContext(
  row: ContextRow | undefined,
  expected: SupabaseRlsSnapshot,
): void {
  if (
    !row ||
    row.session_user !== expected.sessionUser ||
    row.current_user !== expected.currentUser ||
    row.claims !== expected.claimsJson ||
    row.search_path !== expected.searchPath ||
    row.uid !== expected.uid
  ) {
    throw new AgentSqlError(
      "EXECUTION_CONTEXT_CHANGED",
      "Agent SQL changed the protected database request context.",
    );
  }
}

export function createSupabaseRlsAdapter(
  options: SupabaseRlsAdapterOptions,
): IdentityContextAdapter<SupabasePrincipal, SupabaseRlsSnapshot> {
  const expectedSearchPath = options.searchPath.join(", ");

  if (
    !options.loginRole || !options.databaseRole ||
    options.searchPath.length === 0
  ) {
    throw new AgentSqlError(
      "CONFIGURATION_ERROR",
      "The Supabase RLS adapter is incomplete.",
    );
  }

  return {
    validatePrincipal(principal) {
      principalClaims(principal);
    },

    async install(transaction, principal) {
      const { claimsJson, uid } = principalClaims(principal);
      const [attestation] = await transaction.query<AttestationRow>(ATTEST_SQL);
      const memberships = attestation?.memberships ?? [];
      const serverMajor = Math.floor(
        Number(attestation?.server_version_num ?? 0) / 10_000,
      );

      if (serverMajor !== 15 && serverMajor !== 17) {
        throw new AgentSqlError(
          "UNSUPPORTED_POSTGRES_VERSION",
          `PostgreSQL ${
            serverMajor || "unknown"
          } is not supported by this runtime.`,
        );
      }

      if (
        !attestation ||
        attestation.session_user !== options.loginRole ||
        attestation.current_user !== options.loginRole ||
        !attestation.rolcanlogin ||
        attestation.rolinherit ||
        attestation.rolsuper ||
        attestation.rolcreatedb ||
        attestation.rolcreaterole ||
        attestation.rolreplication ||
        attestation.rolbypassrls ||
        attestation.has_owned_objects ||
        memberships.length !== 1 ||
        memberships[0] !== options.databaseRole
      ) {
        throw new AgentSqlError(
          "EXECUTOR_ATTESTATION_FAILED",
          `The database connection must use the isolated ${options.loginRole} role.`,
        );
      }

      await transaction.query(`select set_config('role', $1, true)`, [
        options.databaseRole,
      ]);
      await transaction.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [claimsJson],
      );
      await transaction.query(`select set_config('search_path', $1, true)`, [
        expectedSearchPath,
      ]);

      const expected: SupabaseRlsSnapshot = {
        sessionUser: options.loginRole,
        currentUser: options.databaseRole,
        claimsJson,
        searchPath: expectedSearchPath,
        uid,
      };
      const [installed] = await transaction.query<ContextRow>(CONTEXT_SQL);
      assertContext(installed, expected);
      return expected;
    },

    async verify(transaction, _principal, snapshot) {
      const [current] = await transaction.query<ContextRow>(CONTEXT_SQL);
      assertContext(current, snapshot);
    },

    auditIdentity(principal) {
      const values: Record<string, string> = {};
      if (typeof principal.claims.sub === "string") {
        values.subject = principal.claims.sub;
      }
      if (typeof principal.claims.client_id === "string") {
        values.clientId = principal.claims.client_id;
      }
      return values;
    },
  };
}
