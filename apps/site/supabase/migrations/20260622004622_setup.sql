-- =============================================================================
-- MCP server setup — custom access-token hook + dedicated executor role
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Custom access-token hook
-- -----------------------------------------------------------------------------
--
-- Supabase Auth calls this function when it issues an OAuth access token. For
-- ordinary sessions (no client_id) it returns the event unchanged. For OAuth
-- sessions it adds the MCP resource URL to the token's `aud` claim, which binds
-- the token to this server — a token minted for some other context cannot be
-- replayed here.
--
-- The hook is enabled declaratively in supabase/config.toml
-- ([auth.hook.custom_access_token]). It applies automatically to the local stack
-- on `supabase start`; push it to a hosted project with `supabase config push`.
-- No dashboard toggle is required.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to supabase_auth_admin;

create or replace function private.mcp_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  issuer text;
  resource_url text;
begin
  claims := event -> 'claims';

  -- Ordinary Supabase sessions are not MCP credentials. Only OAuth sessions
  -- have a client_id and receive the MCP audience.
  if claims is null or nullif(claims ->> 'client_id', '') is null then
    return event;
  end if;

  issuer := nullif(claims ->> 'iss', '');
  if issuer is null or issuer !~ '/auth/v1/?$' then
    return event;
  end if;

  resource_url := regexp_replace(issuer, '/auth/v1/?$', '')
    || '/functions/v1/mcp-server';

  claims := jsonb_set(
    claims,
    '{aud}',
    jsonb_build_array('authenticated', resource_url),
    true
  );

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

revoke all on function private.mcp_custom_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function private.mcp_custom_access_token_hook(jsonb)
  to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- 2. Dedicated login role for the agent SQL runtime
-- -----------------------------------------------------------------------------
--
-- WHY THIS ROLE EXISTS
-- --------------------
-- The SQL runtime runs *agent-generated* SQL against this database. To
-- keep Row Level Security (RLS) and grants as the only authorization boundary,
-- the Edge Function connects directly to Postgres and, for every request, does
-- exactly what PostgREST does internally:
--
--     begin;
--       select set_config('role', 'authenticated', true);
--       select set_config('request.jwt.claims', '<the user''s JWT>', true);
--       -- ... the agent's statement runs here, as `authenticated` ...
--     commit;
--
-- The catch: the agent's SQL is untrusted, so it might try to *escape* the
-- `authenticated` role (e.g. `reset role`, `set role postgres`,
-- `select set_config('role', 'postgres', true)`). Whether that succeeds is
-- decided entirely by the role the Edge Function *logged in as* (the Postgres
-- `session_user`) — not by the current role. `SET ROLE` / `RESET ROLE` are only
-- allowed to roles the session_user is a member of, and `RESET ROLE` always
-- returns to the session_user.
--
-- If we logged in as `postgres` (the built-in SUPABASE_DB_URL), `reset role`
-- would drop the agent back to `postgres`, which OWNS the application tables and
-- therefore bypasses RLS — a soft boundary. So instead the function logs in as
-- THIS role:
--
--   * `mcp_sql_executor` is a member of `authenticated` and NOTHING ELSE,
--   * it is NOINHERIT (it has no privileges until it explicitly `set role`),
--   * it owns no objects and is not a superuser.
--
-- Result: there is nothing privileged to escape to. The SQL runtime adds the
-- second required boundary: it parses agent SQL, rejects role/request-context
-- mutation, and verifies the context again before commit. The role alone is not
-- sufficient because Supabase request claims are stored in mutable custom GUCs.
--
-- SETUP (see README → "Runtime configuration")
-- --------------------------------------------
-- This migration only CREATES the role, with no password.
--
-- LOCAL: supabase/seed.sql sets the dev password on `db reset`, and the matching
-- local MCP_DB_URL ships in supabase/functions/.env.example — nothing to do.
--
-- HOSTED: the seed never runs (it is local-only), so set the password once and
-- hand the connection string to the function as the `MCP_DB_URL` secret (never
-- commit a password):
--
--     -- pick a strong password, then, as the postgres/admin role:
--     alter role mcp_sql_executor with password '<STRONG_PASSWORD>';
--
--     -- give the function the connection string for THIS role:
--     supabase secrets set MCP_DB_URL="postgresql://mcp_sql_executor.<PROJECT_REF>:<STRONG_PASSWORD>@<REGION>.pooler.supabase.com:6543/postgres"
--
-- GRANTING THE AGENT ACCESS TO YOUR DATA
-- ----------------------------------------
-- Agent SQL can only do what the `authenticated` role is granted to do.
-- Out of the box that is nothing. For each table the agent should reach, grant
-- the privileges you want and constrain rows with RLS, e.g.:
--
--     grant usage on schema public to authenticated;
--     grant select, insert, update, delete on table public.todos to authenticated;
--     alter table public.todos enable row level security;
--     create policy "Users access their own todos"
--       on public.todos for all to authenticated
--       using ((select auth.uid()) = user_id)
--       with check ((select auth.uid()) = user_id);
--
-- Grant only what you intend the agent to be able to do. DDL stays impossible
-- unless you deliberately grant it (e.g. `grant create on schema public to
-- authenticated`), which is rarely what you want.

-- This migration is applied as `postgres`, which can create roles and is allowed
-- to grant `authenticated`.
create role mcp_sql_executor with
  login         -- the Edge Function connects as this role
  noinherit     -- no privileges until it explicitly `set role authenticated`
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;  -- explicit: this role must never bypass RLS

-- Its only capability: become `authenticated`. It is a member of no other role,
-- so there is no privileged role for untrusted SQL to escape into.
grant authenticated to mcp_sql_executor;

comment on role mcp_sql_executor is
  'Minimal login role for the agent SQL runtime. Member of authenticated only; '
  'connect as this role, then `set role authenticated`. See migration for rationale.';
