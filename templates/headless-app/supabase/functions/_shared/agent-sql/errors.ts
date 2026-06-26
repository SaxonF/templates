export type AgentSqlErrorCode =
  | "CONFIGURATION_ERROR"
  | "UNSUPPORTED_POSTGRES_VERSION"
  | "INVALID_PRINCIPAL"
  | "EXECUTOR_ATTESTATION_FAILED"
  | "SQL_TOO_LARGE"
  | "SQL_PARSE_ERROR"
  | "SQL_MULTIPLE_STATEMENTS"
  | "SQL_MODE_VIOLATION"
  | "SQL_FORBIDDEN_NODE"
  | "SQL_FORBIDDEN_FUNCTION"
  | "EXECUTION_CONTEXT_CHANGED"
  | "RESULT_TOO_LARGE"
  | "DATABASE_ERROR";

export class AgentSqlError extends Error {
  readonly code: AgentSqlErrorCode;
  readonly postgresCode?: string;

  constructor(
    code: AgentSqlErrorCode,
    message: string,
    options?: { postgresCode?: string },
  ) {
    super(message);
    this.name = "AgentSqlError";
    this.code = code;
    this.postgresCode = options?.postgresCode;
  }
}

export function asAgentSqlError(error: unknown): AgentSqlError {
  if (error instanceof AgentSqlError) return error;

  const candidate = error as { message?: unknown; code?: unknown };
  const message = typeof candidate?.message === "string"
    ? candidate.message
    : "The database operation failed.";
  const postgresCode = typeof candidate?.code === "string"
    ? candidate.code
    : undefined;

  return new AgentSqlError("DATABASE_ERROR", message, { postgresCode });
}
