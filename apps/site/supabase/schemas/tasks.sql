-- =============================================================================
-- Tasks schema (declarative)
--
-- Source of truth for the user-owned task management tables the agent reaches
-- through the MCP SQL runtime and the authenticated site renders on /tasks.
-- Edit this file, then regenerate the migration with:
--
--     supabase db diff --schema public -f tasks_schema
--
-- Demo rows for these tables live in supabase/seed/demo_tasks.sql and are
-- local-only; this file defines structure, RLS, and grants only.
--
-- Access control: every row is scoped directly to auth.uid(). The agent SQL
-- runtime executes as `authenticated` with the signed-in user's auth.uid(), so
-- these policies and grants ARE the boundary it is subject to.
-- =============================================================================

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default 'slate',
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  list_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'todo'
    check (status in ('backlog', 'todo', 'in_progress', 'blocked', 'done', 'canceled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  due_on date,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  completed_at timestamptz,
  tags text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (list_id, user_id) references public.task_lists (id, user_id) on delete cascade
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null,
  event_type text not null
    check (event_type in ('created', 'commented', 'status_changed', 'due_date_changed', 'completed')),
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

create index task_lists_user_position_idx
  on public.task_lists (user_id, archived_at, position);
create index tasks_user_status_due_idx
  on public.tasks (user_id, status, due_on);
create index tasks_user_priority_idx
  on public.tasks (user_id, priority, created_at desc);
create index task_events_task_created_idx
  on public.task_events (user_id, task_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger task_lists_set_updated_at
  before update on public.task_lists
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.task_lists enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;

alter table public.profiles force row level security;
alter table public.task_lists force row level security;
alter table public.tasks force row level security;
alter table public.task_events force row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.task_lists to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_events to authenticated;

create policy "users manage their own profile"
  on public.profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users manage their own task lists"
  on public.task_lists for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users manage their own tasks"
  on public.tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users manage their own task events"
  on public.task_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
