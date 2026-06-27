import { AgentSqlError } from "./errors.ts";
import type {
  DatabaseObject,
  DescribeFunctionInput,
  DescribeTableInput,
  FunctionDescription,
  ListObjectsOptions,
  ListObjectsResult,
  TableDescription,
  TrustedTransaction,
} from "./types.ts";

const ANY_TABLE_PRIVILEGE =
  "select,insert,update,delete,references,trigger,truncate";

const LIST_OBJECTS_SQL = `
with objects as (
  select
    'relation'::text as kind,
    n.nspname::text as schema,
    c.relname::text as name,
    ''::text as identity,
    case c.relkind
      when 'r' then 'table'
      when 'v' then 'view'
      when 'm' then 'materialized view'
      when 'p' then 'partitioned table'
      when 'f' then 'foreign table'
    end::text as relation_kind,
    null::text as arguments,
    null::text as returns,
    null::text as volatility,
    null::text as security
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'p', 'f')
    and n.nspname <> all($1::text[])
    and has_schema_privilege(n.oid, 'usage')
    and has_table_privilege(c.oid, '${ANY_TABLE_PRIVILEGE}')

  union all

  select
    'function'::text as kind,
    n.nspname::text as schema,
    p.proname::text as name,
    pg_get_function_identity_arguments(p.oid)::text as identity,
    null::text as relation_kind,
    pg_get_function_arguments(p.oid)::text as arguments,
    pg_get_function_result(p.oid)::text as returns,
    case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
    case when p.prosecdef then 'definer' else 'invoker' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and n.nspname <> all($1::text[])
    and has_schema_privilege(n.oid, 'usage')
    and has_function_privilege(p.oid, 'execute')
)
select *
from objects
where ($2::text is null or schema = $2)
  and ($3::text is null or kind = $3)
  and (
    $4::text is null
    or (kind, schema, name, identity) > ($4, $5, $6, $7)
  )
order by kind, schema, name, identity
limit $8
`;

const DESCRIBE_TABLE_SQL = `
with t as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1
    and c.relname = $2
    and n.nspname <> all($3::text[])
    and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and has_schema_privilege(n.oid, 'usage')
    and has_table_privilege(c.oid, '${ANY_TABLE_PRIVILEGE}')
)
select jsonb_build_object(
  'schema', t.nspname,
  'name', t.relname,
  'kind', case t.relkind
    when 'r' then 'table'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'p' then 'partitioned table'
    when 'f' then 'foreign table'
  end,
  'rls_enabled', t.relrowsecurity,
  'comment', obj_description(t.oid),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'nullable', not a.attnotnull,
      'default', pg_get_expr(ad.adbin, ad.adrelid),
      'comment', col_description(t.oid, a.attnum)
    ) order by a.attnum)
    from pg_attribute a
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'primary_key', (
    select jsonb_agg(a.attname order by key.ord)
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as key(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = key.attnum
    where con.conrelid = t.oid and con.contype = 'p'
  ),
  'foreign_keys', coalesce((
    select jsonb_agg(jsonb_build_object(
      'columns', (
        select jsonb_agg(a.attname order by key.ord)
        from unnest(con.conkey) with ordinality as key(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = key.attnum
      ),
      'references', foreign_namespace.nspname || '.' || foreign_class.relname,
      'references_columns', (
        select jsonb_agg(a.attname order by key.ord)
        from unnest(con.confkey) with ordinality as key(attnum, ord)
        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = key.attnum
      )
    ))
    from pg_constraint con
    join pg_class foreign_class on foreign_class.oid = con.confrelid
    join pg_namespace foreign_namespace on foreign_namespace.oid = foreign_class.relnamespace
    where con.conrelid = t.oid and con.contype = 'f'
  ), '[]'::jsonb)
) as definition
from t
`;

const DESCRIBE_FUNCTION_SQL = `
select coalesce(jsonb_agg(jsonb_build_object(
  'schema', n.nspname,
  'name', p.proname,
  'language', language.lanname,
  'returns', pg_get_function_result(p.oid),
  'arguments', pg_get_function_arguments(p.oid),
  'identity_arguments', pg_get_function_identity_arguments(p.oid),
  'volatility', case p.provolatile
    when 'i' then 'immutable'
    when 's' then 'stable'
    when 'v' then 'volatile'
  end,
  'security', case when p.prosecdef then 'definer' else 'invoker' end,
  'security_warning', case when p.prosecdef
    then 'This function runs with its owner privileges; review it before agent use.'
    else null
  end,
  'comment', obj_description(p.oid)
) order by pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) as definitions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language language on language.oid = p.prolang
where n.nspname = $1
  and p.proname = $2
  and n.nspname <> all($3::text[])
  and p.prokind = 'f'
  and has_schema_privilege(n.oid, 'usage')
  and has_function_privilege(p.oid, 'execute')
`;

type ObjectRow = {
  kind: "relation" | "function";
  schema: string;
  name: string;
  identity: string;
  relation_kind: string | null;
  arguments: string | null;
  returns: string | null;
  volatility: "immutable" | "stable" | "volatile" | null;
  security: "invoker" | "definer" | null;
};

type CursorValue = {
  version: 1;
  kind: "relation" | "function";
  schema: string;
  name: string;
  identity: string;
};

function encodeCursor(value: CursorValue): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeCursor(value?: string): CursorValue | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CursorValue;
    if (
      parsed.version !== 1 ||
      (parsed.kind !== "relation" && parsed.kind !== "function") ||
      typeof parsed.schema !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.identity !== "string"
    ) throw new Error("Invalid cursor");
    return parsed;
  } catch {
    throw new AgentSqlError(
      "SQL_PARSE_ERROR",
      "The database object cursor is invalid.",
    );
  }
}

export async function listDatabaseObjects(
  transaction: TrustedTransaction,
  excludedSchemas: string[],
  options: ListObjectsOptions,
): Promise<ListObjectsResult> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AgentSqlError(
      "CONFIGURATION_ERROR",
      "Object list limit must be from 1 to 100.",
    );
  }
  const cursor = decodeCursor(options.cursor);
  const rows = await transaction.query<ObjectRow>(LIST_OBJECTS_SQL, [
    excludedSchemas,
    options.schema ?? null,
    options.kind ?? null,
    cursor?.kind ?? null,
    cursor?.schema ?? "",
    cursor?.name ?? "",
    cursor?.identity ?? "",
    limit + 1,
  ]);
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);

  const objects: DatabaseObject[] = returned.map((row) => ({
    kind: row.kind,
    schema: row.schema,
    name: row.name,
    ...(row.relation_kind ? { relationKind: row.relation_kind } : {}),
    ...(row.arguments !== null ? { arguments: row.arguments } : {}),
    ...(row.returns !== null ? { returns: row.returns } : {}),
    ...(row.volatility ? { volatility: row.volatility } : {}),
    ...(row.security ? { security: row.security } : {}),
  }));

  const last = returned.at(-1);
  const nextCursor = hasMore && last
    ? encodeCursor({
      version: 1,
      kind: last.kind,
      schema: last.schema,
      name: last.name,
      identity: last.identity,
    })
    : null;

  return { objects, nextCursor };
}

export async function describeTable(
  transaction: TrustedTransaction,
  input: DescribeTableInput,
  excludedSchemas: string[] = [],
): Promise<TableDescription | null> {
  const rows = await transaction.query<{ definition: TableDescription }>(
    DESCRIBE_TABLE_SQL,
    [input.schema ?? "public", input.table, excludedSchemas],
  );
  return rows[0]?.definition ?? null;
}

export async function describeFunction(
  transaction: TrustedTransaction,
  input: DescribeFunctionInput,
  excludedSchemas: string[] = [],
): Promise<FunctionDescription[]> {
  const rows = await transaction.query<{ definitions: FunctionDescription[] }>(
    DESCRIBE_FUNCTION_SQL,
    [input.schema ?? "public", input.name, excludedSchemas],
  );
  return rows[0]?.definitions ?? [];
}
