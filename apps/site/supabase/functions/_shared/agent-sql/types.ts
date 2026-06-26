export type JsonObject = Record<string, unknown>;

export type SqlMode = "query" | "mutation";

export type StatementKind = "select" | "insert" | "update" | "delete" | "merge";

export type RuntimeLimits = {
  maxSqlBytes: number;
  maxRows: number;
  maxResultBytes: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
};

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  maxSqlBytes: 65_536,
  maxRows: 1_000,
  maxResultBytes: 1_000_000,
  statementTimeoutMs: 15_000,
  lockTimeoutMs: 2_000,
};

export type SqlExecutionResult = {
  kind: StatementKind;
  command: string;
  /** Returned rows for SELECT; affected rows for mutations. */
  rowCount: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
};

export type ValidatedStatement = {
  kind: StatementKind;
  text: string;
  parserVersion: number;
};

export interface TrustedTransaction {
  query<Row = Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>;
}

export interface IdentityContextAdapter<Principal, Snapshot> {
  validatePrincipal(principal: Principal): void;
  install(
    transaction: TrustedTransaction,
    principal: Principal,
  ): Promise<Snapshot>;
  verify(
    transaction: TrustedTransaction,
    principal: Principal,
    snapshot: Snapshot,
  ): Promise<void>;
  auditIdentity?(principal: Principal): Record<string, string>;
}

export type AgentSqlEvent = {
  type: "execution_succeeded" | "execution_failed" | "policy_rejected";
  mode: SqlMode;
  kind?: StatementKind;
  durationMs: number;
  rowCount?: number;
  truncated?: boolean;
  errorCode?: string;
  identity?: Record<string, string>;
};

export type AgentSqlRuntimeOptions<Principal, Snapshot> = {
  databaseUrl: string;
  identity: IdentityContextAdapter<Principal, Snapshot>;
  limits?: Partial<RuntimeLimits>;
  excludedSchemas?: string[];
  pool?: {
    maxConnections?: number;
    idleTimeoutSeconds?: number;
    connectTimeoutSeconds?: number;
  };
  onEvent?: (event: AgentSqlEvent) => void;
};

export type DatabaseObjectKind = "relation" | "function";

export type DatabaseObject = {
  kind: DatabaseObjectKind;
  schema: string;
  name: string;
  relationKind?: string;
  arguments?: string;
  returns?: string;
  volatility?: "immutable" | "stable" | "volatile";
  security?: "invoker" | "definer";
};

export type ListObjectsOptions = {
  schema?: string;
  kind?: DatabaseObjectKind;
  limit?: number;
  cursor?: string;
};

export type ListObjectsResult = {
  objects: DatabaseObject[];
  nextCursor: string | null;
};

export type DescribeTableInput = {
  schema?: string;
  table: string;
};

export type TableDescription = Record<string, unknown>;

export type DescribeFunctionInput = {
  schema?: string;
  name: string;
};

export type FunctionDescription = Record<string, unknown>;
