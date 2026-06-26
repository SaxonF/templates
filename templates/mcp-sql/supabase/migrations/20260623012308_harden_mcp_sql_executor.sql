grant authenticated to mcp_sql_executor;

-- Hosted Supabase's project-level `postgres` role can create ordinary roles,
-- but intentionally cannot ALTER superuser-class attributes after creation.
-- Validate the original role definition here and fail the migration rather
-- than pretending to harden a role that no longer satisfies the boundary.
do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'mcp_sql_executor'
      and rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
  ) then
    raise exception
      'mcp_sql_executor no longer has the required isolated role attributes';
  end if;

  if (
    select coalesce(
      array_agg(parent.rolname::text order by parent.rolname::text),
      array[]::text[]
    )
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where member.rolname = 'mcp_sql_executor'
  ) <> array['authenticated']::text[] then
    raise exception
      'mcp_sql_executor must be a direct member of authenticated only';
  end if;

  if exists (
    select 1
    from pg_shdepend dependency
    join pg_roles role on role.oid = dependency.refobjid
    where dependency.refclassid = 'pg_authid'::regclass
      and dependency.deptype = 'o'
      and role.rolname = 'mcp_sql_executor'
  ) then
    raise exception 'mcp_sql_executor must not own database objects';
  end if;
end;
$$;

comment on role mcp_sql_executor is
  'Isolated login for the agent SQL runtime. Member of authenticated only; owns no objects.';
