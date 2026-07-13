-- MCP servers whose tools can be exposed to the streaming agent endpoint.

create table if not exists public.agent_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  url text not null,
  headers jsonb not null default '{}',
  enabled boolean not null default true,
  metadata jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.agent_mcp_servers is 'MCP servers whose tools can be exposed to the streaming agent endpoint. url may be a relative function path (/functions/v1/...) or an external absolute URL. Avoid storing long-lived secrets in headers.';

alter table public.agent_mcp_servers enable row level security;

create policy "Authenticated users can read enabled MCP servers"
on public.agent_mcp_servers
for select
to authenticated
using (enabled = true);

grant select on table public.agent_mcp_servers to authenticated;
grant select on table public.agent_mcp_servers to service_role;

-- Optional seed: documents the intended relative-path pattern for the bundled mcp-server.
insert into public.agent_mcp_servers (name, url)
values ('project', '/functions/v1/mcp-server')
on conflict (name) do nothing;
