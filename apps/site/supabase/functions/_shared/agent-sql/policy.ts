import PgQueryModule from "npm:pg-query-emscripten@5.1.0";

import { AgentSqlError } from "./errors.ts";
import type { SqlMode, StatementKind, ValidatedStatement } from "./types.ts";

const TEXT_ENCODER = new TextEncoder();

const ROOT_KIND: Record<string, StatementKind> = {
  SelectStmt: "select",
  InsertStmt: "insert",
  UpdateStmt: "update",
  DeleteStmt: "delete",
  MergeStmt: "merge",
};

const MUTATION_NODES = new Set([
  "InsertStmt",
  "UpdateStmt",
  "DeleteStmt",
  "MergeStmt",
]);

const QUERY_FORBIDDEN_NODES = new Set(["IntoClause", "LockingClause"]);

const FORBIDDEN_FUNCTIONS = new Set([
  "set_config",
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_try_advisory_lock",
  "pg_try_advisory_lock_shared",
  "pg_advisory_unlock",
  "pg_advisory_unlock_shared",
  "pg_advisory_unlock_all",
  "pg_notify",
]);

type ParseResult = {
  version?: number;
  stmts?: Array<{
    stmt?: Record<string, unknown>;
    stmt_len?: number;
    stmt_location?: number;
  }>;
};

type BrowserParser = {
  parse(sql: string): {
    parse_tree?: ParseResult;
    error?: { message?: string } | string | null;
    stderr_buffer?: string;
  };
};

let parserPromise: Promise<BrowserParser> | null = null;

async function parser(): Promise<BrowserParser> {
  parserPromise ??= Promise.resolve(
    new PgQueryModule() as unknown as Promise<BrowserParser>,
  );
  return await parserPromise;
}

function nodeTag(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || !/^[A-Z]/.test(keys[0])) return null;
  return keys[0];
}

function stringNodeValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const stringNode = (value as Record<string, unknown>).String;
  if (!stringNode || typeof stringNode !== "object") return null;
  const record = stringNode as Record<string, unknown>;
  if (typeof record.sval === "string") return record.sval;
  if (typeof record.str === "string") return record.str;
  return null;
}

function functionName(funcCall: unknown): string | null {
  if (!funcCall || typeof funcCall !== "object") return null;
  const names = (funcCall as Record<string, unknown>).funcname;
  if (!Array.isArray(names) || names.length === 0) return null;
  return stringNodeValue(names[names.length - 1])?.toLowerCase() ?? null;
}

function inspectAst(value: unknown, mode: SqlMode, isRoot = false): void {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const child of value) inspectAst(child, mode);
    return;
  }

  const record = value as Record<string, unknown>;
  const tag = nodeTag(record);

  // PostgreSQL represents SELECT INTO as an untagged intoClause property on
  // SelectStmt rather than an { IntoClause: ... } node.
  if (mode === "query" && record.intoClause) {
    throw new AgentSqlError(
      "SQL_FORBIDDEN_NODE",
      "query_sql does not allow SELECT INTO.",
    );
  }

  if (!isRoot && mode === "query" && tag && MUTATION_NODES.has(tag)) {
    throw new AgentSqlError(
      "SQL_MODE_VIOLATION",
      "query_sql does not allow data-modifying statements inside a SELECT.",
    );
  }

  if (mode === "query" && tag && QUERY_FORBIDDEN_NODES.has(tag)) {
    throw new AgentSqlError(
      "SQL_FORBIDDEN_NODE",
      tag === "IntoClause"
        ? "query_sql does not allow SELECT INTO."
        : "query_sql does not allow row-locking clauses.",
    );
  }

  const funcCall = record.FuncCall;
  if (funcCall) {
    const name = functionName(funcCall);
    if (name && FORBIDDEN_FUNCTIONS.has(name)) {
      throw new AgentSqlError(
        "SQL_FORBIDDEN_FUNCTION",
        `The function ${name} is not available to agent SQL.`,
      );
    }
  }

  for (const child of Object.values(record)) inspectAst(child, mode);
}

function statementText(
  sql: string,
  raw: NonNullable<ParseResult["stmts"]>[number],
): string {
  const start = raw.stmt_location ?? 0;
  const length = raw.stmt_len ?? 0;
  const text = length > 0 ? sql.slice(start, start + length) : sql.slice(start);
  return text.trimEnd();
}

export async function validateAgentSql(
  sql: string,
  mode: SqlMode,
  maxSqlBytes: number,
): Promise<ValidatedStatement> {
  if (TEXT_ENCODER.encode(sql).byteLength > maxSqlBytes) {
    throw new AgentSqlError(
      "SQL_TOO_LARGE",
      `SQL exceeds the ${maxSqlBytes}-byte limit.`,
    );
  }

  let parsed: ParseResult;
  try {
    const result = (await parser()).parse(sql);
    if (result.error) {
      const errorMessage = typeof result.error === "string"
        ? result.error
        : result.error.message;
      throw new Error(
        errorMessage || result.stderr_buffer || "Invalid PostgreSQL syntax.",
      );
    }
    if (!result.parse_tree) {
      throw new Error("The PostgreSQL parser returned no syntax tree.");
    }
    parsed = result.parse_tree;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Invalid PostgreSQL syntax.";
    throw new AgentSqlError("SQL_PARSE_ERROR", message);
  }

  const statements = parsed.stmts ?? [];
  if (statements.length !== 1) {
    throw new AgentSqlError(
      statements.length === 0 ? "SQL_PARSE_ERROR" : "SQL_MULTIPLE_STATEMENTS",
      statements.length === 0
        ? "A non-empty SQL statement is required."
        : "Exactly one SQL statement is allowed.",
    );
  }

  const root = statements[0].stmt;
  if (!root) {
    throw new AgentSqlError(
      "SQL_PARSE_ERROR",
      "Unable to identify the SQL statement.",
    );
  }
  const rootTag = Object.keys(root)[0];
  const kind = ROOT_KIND[rootTag];

  if (!kind) {
    throw new AgentSqlError(
      "SQL_MODE_VIOLATION",
      mode === "query"
        ? "query_sql accepts one SELECT statement."
        : "execute_sql accepts one INSERT, UPDATE, DELETE, or MERGE statement.",
    );
  }

  if (mode === "query" && kind !== "select") {
    throw new AgentSqlError(
      "SQL_MODE_VIOLATION",
      "query_sql accepts one SELECT statement.",
    );
  }
  if (mode === "mutation" && kind === "select") {
    throw new AgentSqlError(
      "SQL_MODE_VIOLATION",
      "execute_sql accepts one INSERT, UPDATE, DELETE, or MERGE statement.",
    );
  }

  inspectAst(root, mode, true);

  return {
    kind,
    text: statementText(sql, statements[0]),
    parserVersion: parsed.version ?? 17_0000,
  };
}
