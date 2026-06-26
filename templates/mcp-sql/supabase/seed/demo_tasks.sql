-- =============================================================================
-- Local-only demo data: individual task management for validating that Row
-- Level Security (and therefore the agent SQL runtime) isolates one
-- authenticated user's data from another's.
--
-- This runs only via `supabase db reset` (local); seeds are never applied to a
-- hosted project. Delete this file to remove the demo.
--
-- Sign in at /auth/ as any of these users (password for all: password123):
--   alice@example.com
--   bob@example.com
--   carol@example.com
--
-- Expected access control: each user sees and manages only their own profile,
-- lists, tasks, and task history. There are intentionally no teams or shared
-- resources in this demo schema.
--
-- The schema and its dependent rows live in one DO block on purpose: the CLI
-- seed runner parses every top-level statement up front, so a table created in
-- an earlier statement is not visible to a later one. A DO block is a single
-- statement whose body is planned at run time, after each object exists.
-- =============================================================================

-- Test auth users (fixed UUIDs so the rows below can reference them). These
-- reference only existing catalogs, so they can run as ordinary statements.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'alice@example.com',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'bob@example.com',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'carol@example.com',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111',
   '{"sub":"11111111-1111-4111-8111-111111111111","email":"alice@example.com","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222',
   '{"sub":"22222222-2222-4222-8222-222222222222","email":"bob@example.com","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333333',
   '{"sub":"33333333-3333-4333-8333-333333333333","email":"carol@example.com","email_verified":true}',
   'email', now(), now(), now())
on conflict do nothing;

do $demo$
begin
  -- ---------------------------------------------------------------------------
  -- Schema: user-owned task management
  -- ---------------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------------
  -- Access control: every row is scoped directly to auth.uid()
  --
  -- The agent SQL runtime executes as `authenticated` with the signed-in user's
  -- auth.uid(), so these policies ARE the boundary it is subject to.
  -- ---------------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------------
  -- Demo rows: same shape for each user, different content and priorities.
  -- ---------------------------------------------------------------------------
  insert into public.profiles (user_id, display_name, timezone) values
    ('11111111-1111-4111-8111-111111111111', 'Alice Chen', 'Australia/Brisbane'),
    ('22222222-2222-4222-8222-222222222222', 'Bob Smith', 'America/Los_Angeles'),
    ('33333333-3333-4333-8333-333333333333', 'Carol Diaz', 'Europe/London');

  insert into public.task_lists (id, user_id, name, color, position) values
    ('11111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Inbox', 'slate', 1),
    ('11111111-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Product Launch', 'orange', 2),
    ('22222222-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Inbox', 'slate', 1),
    ('22222222-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Home Renovation', 'blue', 2),
    ('33333333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Inbox', 'slate', 1),
    ('33333333-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Research Sprint', 'green', 2);

  insert into public.tasks (
    id, user_id, list_id, title, description, status, priority, due_on,
    estimate_minutes, tags, position, completed_at
  )
  values
    ('11111111-1000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
     '11111111-0000-4000-8000-000000000002', 'Draft launch checklist',
     'Break the launch into owner-ready tasks.', 'in_progress', 'high',
     current_date + 1, 45, array['launch', 'planning'], 1, null),
    ('11111111-1000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
     '11111111-0000-4000-8000-000000000002', 'Review signup analytics',
     'Compare activation from the last three release cohorts.', 'todo', 'medium',
     current_date + 3, 60, array['analytics'], 2, null),
    ('11111111-1000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
     '11111111-0000-4000-8000-000000000001', 'Book dentist appointment',
     '', 'done', 'low', current_date - 1, 15, array['personal'], 3, now()),

    ('22222222-1000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
     '22222222-0000-4000-8000-000000000002', 'Order paint samples',
     'Pick three neutral colors for the office.', 'todo', 'medium',
     current_date + 2, 30, array['home'], 1, null),
    ('22222222-1000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
     '22222222-0000-4000-8000-000000000002', 'Call electrician',
     'Confirm quote for new outlets.', 'blocked', 'urgent',
     current_date, 20, array['home', 'vendor'], 2, null),
    ('22222222-1000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222',
     '22222222-0000-4000-8000-000000000001', 'Renew passport',
     '', 'backlog', 'high', current_date + 14, 90, array['personal'], 3, null),

    ('33333333-1000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
     '33333333-0000-4000-8000-000000000002', 'Summarize interview notes',
     'Extract themes from the first five customer calls.', 'in_progress', 'high',
     current_date + 1, 75, array['research'], 1, null),
    ('33333333-1000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
     '33333333-0000-4000-8000-000000000002', 'Prepare prototype questions',
     '', 'todo', 'medium', current_date + 4, 40, array['research', 'prototype'], 2, null),
    ('33333333-1000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
     '33333333-0000-4000-8000-000000000001', 'Submit expenses',
     '', 'done', 'low', current_date - 2, 20, array['admin'], 3, now());

  insert into public.task_events (user_id, task_id, event_type, body, metadata) values
    ('11111111-1111-4111-8111-111111111111', '11111111-1000-4000-8000-000000000001',
     'created', 'Task created from launch planning notes.', '{"source":"seed"}'),
    ('11111111-1111-4111-8111-111111111111', '11111111-1000-4000-8000-000000000001',
     'status_changed', 'Moved from todo to in_progress.', '{"from":"todo","to":"in_progress"}'),
    ('22222222-2222-4222-8222-222222222222', '22222222-1000-4000-8000-000000000002',
     'commented', 'Waiting on callback before scheduling work.', '{"source":"seed"}'),
    ('33333333-3333-4333-8333-333333333333', '33333333-1000-4000-8000-000000000001',
     'created', 'Imported from interview synthesis plan.', '{"source":"seed"}');
end
$demo$;
