-- Local development only.
--
-- `supabase db reset` runs this seed; `supabase db push` never does, so the
-- password set here cannot reach a hosted project. This removes the manual
-- `alter role ... with password` step from local setup: after `db reset`, the
-- committed local MCP_DB_URL in supabase/functions/.env.example works as-is.
--
-- The migration creates the `mcp_sql_executor` login with no password; this
-- gives it the local development password. Keep it in sync with .env.example.
alter role mcp_sql_executor with password 'local-dev-password';
