-- =============================================================================
-- MCP server — custom access-token hook
-- =============================================================================
--
-- Supabase Auth calls this function when it issues an OAuth access token. For
-- ordinary sessions (no client_id) it returns the event unchanged. For OAuth
-- sessions it adds the MCP resource URL to the token's `aud` claim, which binds
-- the token to this server — a token minted for some other context cannot be
-- replayed here. The MCP server's OAuth-mode auth requires this binding.
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
