-- Individual messages and tool results within an agent session.

create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.agent_sessions on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text,
  state jsonb not null default '{}',
  created_at timestamptz default now()
);

comment on table public.agent_memories is 'Individual messages and tool results within a session.';

create index if not exists agent_memories_session_id_idx on public.agent_memories (session_id);

alter table public.agent_memories enable row level security;

create policy "Users can read memories in their sessions"
on public.agent_memories
for select
to authenticated
using (
  exists (
    select 1
    from public.agent_sessions
    where agent_sessions.id = agent_memories.session_id
      and agent_sessions.user_id = auth.uid()
  )
);

create policy "Users can insert memories in their sessions"
on public.agent_memories
for insert
to authenticated
with check (
  exists (
    select 1
    from public.agent_sessions
    where agent_sessions.id = agent_memories.session_id
      and agent_sessions.user_id = auth.uid()
  )
);

grant select, insert, update, delete on table public.agent_memories to authenticated;

-- agent-chat persists messages with the service role (bypasses RLS after verifying the user JWT).
grant select, insert, update, delete on table public.agent_memories to service_role;
