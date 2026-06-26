-- =============================================================================
-- Dedicated login role for the agent SQL runtime
-- =============================================================================
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
