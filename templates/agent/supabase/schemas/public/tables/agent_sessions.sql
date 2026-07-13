-- Conversation sessions for a streaming AI agent. One row per user conversation.

create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  title text,
  metadata jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.agent_sessions is 'Conversation sessions for an agent or user.';

alter table public.agent_sessions enable row level security;

create policy "Users can read their own sessions"
on public.agent_sessions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
on public.agent_sessions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own sessions"
on public.agent_sessions
for update
to authenticated
using (auth.uid() = user_id);

create policy "Users can delete their own sessions"
on public.agent_sessions
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on table public.agent_sessions to authenticated;

-- agent-chat persists sessions with the service role (bypasses RLS after verifying the user JWT).
grant select, insert, update, delete on table public.agent_sessions to service_role;

-- The agent tables use uuid primary keys today, but keep sequence access forward-compatible.
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;
