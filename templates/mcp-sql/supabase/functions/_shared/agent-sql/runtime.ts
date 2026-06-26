import postgres from "npm:postgres@3.4.7";

import {
  describeFunction as describeFunctionInTransaction,
  describeTable as describeTableInTransaction,
  listDatabaseObjects as listDatabaseObjectsInTransaction,
} from "./catalog.ts";
import { AgentSqlError, asAgentSqlError } from "./errors.ts";
import { validateAgentSql } from "./policy.ts";
import {
  type AgentSqlEvent,
  type AgentSqlRuntimeOptions,
  DEFAULT_RUNTIME_LIMITS,
  type DescribeFunctionInput,
  type DescribeTableInput,
  type FunctionDescription,
  type ListObjectsOptions,
  type ListObjectsResult,
  type RuntimeLimits,
  type SqlExecutionResult,
  type SqlMode,
  type TableDescription,
  type TrustedTransaction,
  type ValidatedStatement,
} from "./types.ts";

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

type Sql = ReturnType<typeof postgres>;
type DriverResult = Array<Record<string, unknown>> & {
  count?: number;
  command?: string;
};

export interface AgentSqlRuntime<Principal> {
  query(principal: Principal, statement: string): Promise<SqlExecutionResult>;
  mutate(principal: Principal, statement: string): Promise<SqlExecutionResult>;
  listDatabaseObjects(
    principal: Principal,
    options?: ListObjectsOptions,
  ): Promise<ListObjectsResult>;
  describeTable(
    principal: Principal,
    input: DescribeTableInput,
  ): Promise<TableDescription | null>;
  describeFunction(
    principal: Principal,
    input: DescribeFunctionInput,
  ): Promise<FunctionDescription[]>;
  close(): Promise<void>;
}

function validateLimits(input: RuntimeLimits): RuntimeLimits {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new AgentSqlError(
        "CONFIGURATION_ERROR",
        `${name} must be a positive integer.`,
      );
    }
  }
  return input;
}

function boundedRows(
  input: Record<string, unknown>[],
  limits: RuntimeLimits,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  const rows: Record<string, unknown>[] = [];
  let bytes = 2;
  let truncated = input.length > limits.maxRows;

  for (const row of input.slice(0, limits.maxRows)) {
    const json = JSON.stringify(row);
    const rowBytes = new TextEncoder().encode(json ?? "null").byteLength + 1;
    if (bytes + rowBytes > limits.maxResultBytes) {
      truncated = true;
      break;
    }
    rows.push(row);
    bytes += rowBytes;
  }
  return { rows, truncated };
}

function queryText(statement: ValidatedStatement, maxRows: number): string {
  return `select *\nfrom (\n${statement.text}\n) as "__agent_query"\nlimit ${
    maxRows + 1
  }`;
}

export function createAgentSqlRuntime<Principal, Snapshot>(
  options: AgentSqlRuntimeOptions<Principal, Snapshot>,
): AgentSqlRuntime<Principal> {
  if (!options.databaseUrl?.trim()) {
    throw new AgentSqlError(
      "CONFIGURATION_ERROR",
      "A database URL is required.",
    );
  }

  const limits = validateLimits({
    ...DEFAULT_RUNTIME_LIMITS,
    ...options.limits,
  });
  const excludedSchemas = options.excludedSchemas ?? DEFAULT_EXCLUDED_SCHEMAS;
  const sql = postgres(options.databaseUrl, {
    prepare: false,
    max: options.pool?.maxConnections ?? 4,
    idle_timeout: options.pool?.idleTimeoutSeconds ?? 20,
    connect_timeout: options.pool?.connectTimeoutSeconds ?? 10,
  });

  function emit(event: AgentSqlEvent): void {
    try {
      options.onEvent?.(event);
    } catch {
      // Observability must never change transaction or authorization behavior.
    }
  }

  function identity(principal: Principal): Record<string, string> | undefined {
    try {
      return options.identity.auditIdentity?.(principal);
    } catch {
      return undefined;
    }
  }

  function trustedTransaction(tx: Sql): TrustedTransaction {
    return {
      async query<Row>(
        text: string,
        parameters: readonly unknown[] = [],
      ): Promise<Row[]> {
        const result = await tx.unsafe(
          text,
          [...parameters] as never[],
        ) as unknown as Row[];
        return [...result];
      },
    };
  }

  async function inUserTransaction<T>(
    principal: Principal,
    readOnly: boolean,
    operation: (transaction: TrustedTransaction, tx: Sql) => Promise<T>,
  ): Promise<T> {
    const callback = async (rawTransaction: unknown): Promise<T> => {
      const tx = rawTransaction as Sql;
      const transaction = trustedTransaction(tx);
      await transaction.query(
        `select set_config('statement_timeout', $1, true)`,
        [
          `${limits.statementTimeoutMs}ms`,
        ],
      );
      await transaction.query(`select set_config('lock_timeout', $1, true)`, [
        `${limits.lockTimeoutMs}ms`,
      ]);
      const snapshot = await options.identity.install(transaction, principal);
      const result = await operation(transaction, tx);
      await options.identity.verify(transaction, principal, snapshot);
      return result;
    };

    return readOnly
      ? await sql.begin("read only", callback) as T
      : await sql.begin(callback) as T;
  }

  async function validate(
    principal: Principal,
    statement: string,
    mode: SqlMode,
  ): Promise<ValidatedStatement> {
    const started = performance.now();
    try {
      options.identity.validatePrincipal(principal);
      return await validateAgentSql(statement, mode, limits.maxSqlBytes);
    } catch (error) {
      const mapped = asAgentSqlError(error);
      emit({
        type: "policy_rejected",
        mode,
        durationMs: performance.now() - started,
        errorCode: mapped.code,
        identity: identity(principal),
      });
      throw mapped;
    }
  }

  async function execute(
    principal: Principal,
    statementText: string,
    mode: SqlMode,
  ): Promise<SqlExecutionResult> {
    const statement = await validate(principal, statementText, mode);
    const started = performance.now();

    try {
      const result = await inUserTransaction(
        principal,
        mode === "query",
        async (_transaction, tx) => {
          const text = mode === "query"
            ? queryText(statement, limits.maxRows)
            : statement.text;
          const driverResult = await tx.unsafe(text) as unknown as DriverResult;
          const rawRows = [...driverResult];
          const bounded = boundedRows(rawRows, limits);
          const truncated = bounded.truncated ||
            (mode === "query" && rawRows.length > limits.maxRows);

          return {
            kind: statement.kind,
            command: driverResult.command ?? statement.kind.toUpperCase(),
            rowCount: mode === "query"
              ? bounded.rows.length
              : typeof driverResult.count === "number"
              ? driverResult.count
              : rawRows.length,
            rows: bounded.rows,
            truncated,
          } satisfies SqlExecutionResult;
        },
      );

      emit({
        type: "execution_succeeded",
        mode,
        kind: statement.kind,
        durationMs: performance.now() - started,
        rowCount: result.rowCount,
        truncated: result.truncated,
        identity: identity(principal),
      });
      return result;
    } catch (error) {
      const mapped = asAgentSqlError(error);
      emit({
        type: "execution_failed",
        mode,
        kind: statement.kind,
        durationMs: performance.now() - started,
        errorCode: mapped.code,
        identity: identity(principal),
      });
      throw mapped;
    }
  }

  async function trustedRead<T>(
    principal: Principal,
    operation: (transaction: TrustedTransaction) => Promise<T>,
  ): Promise<T> {
    options.identity.validatePrincipal(principal);
    return await inUserTransaction(principal, true, async (transaction) => {
      return await operation(transaction);
    });
  }

  return {
    query: (principal, statement) => execute(principal, statement, "query"),
    mutate: (principal, statement) => execute(principal, statement, "mutation"),

    listDatabaseObjects(principal, listOptions = {}) {
      return trustedRead(
        principal,
        (transaction) =>
          listDatabaseObjectsInTransaction(
            transaction,
            excludedSchemas,
            listOptions,
          ),
      );
    },

    describeTable(principal, input) {
      return trustedRead(
        principal,
        (transaction) => describeTableInTransaction(transaction, input),
      );
    },

    describeFunction(principal, input) {
      return trustedRead(
        principal,
        (transaction) => describeFunctionInTransaction(transaction, input),
      );
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
