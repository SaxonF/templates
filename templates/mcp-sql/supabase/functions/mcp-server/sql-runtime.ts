import {
  type AgentSqlRuntime,
  createAgentSqlRuntime,
  createSupabaseRlsAdapter,
  type SupabasePrincipal,
} from "../_shared/agent-sql/mod.ts";

let runtime: AgentSqlRuntime<SupabasePrincipal> | null = null;

function readRequired(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Deno.env.get(name)?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

// The agent SQL runtime is a module singleton: tool registration pulls it from
// here instead of receiving it through the base ToolContext, so the framework
// never has to know this tool template exists.
export function getSqlRuntime(): AgentSqlRuntime<SupabasePrincipal> {
  if (runtime) return runtime;

  runtime = createAgentSqlRuntime({
    databaseUrl: readRequired("MCP_DB_URL"),
    identity: createSupabaseRlsAdapter({
      loginRole: "mcp_sql_executor",
      databaseRole: "authenticated",
      searchPath: ["public", "extensions"],
    }),
    limits: {
      maxSqlBytes: readPositiveInteger("MCP_SQL_MAX_QUERY_BYTES", 65_536),
      maxRows: readPositiveInteger("MCP_SQL_MAX_ROWS", 1_000),
      maxResultBytes: readPositiveInteger(
        "MCP_SQL_MAX_RESULT_BYTES",
        1_000_000,
      ),
      statementTimeoutMs: readPositiveInteger(
        "MCP_SQL_STATEMENT_TIMEOUT_MS",
        15_000,
      ),
      lockTimeoutMs: readPositiveInteger("MCP_SQL_LOCK_TIMEOUT_MS", 2_000),
    },
    onEvent(event) {
      console.info("agent_sql", JSON.stringify(event));
    },
  });
  return runtime;
}
