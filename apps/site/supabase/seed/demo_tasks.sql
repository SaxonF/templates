-- =============================================================================
-- Local-only demo data for the tasks schema.
--
-- The schema itself (profiles, task_lists, tasks, task_events + RLS, grants) is
-- defined declaratively in supabase/schemas/tasks.sql and shipped as a versioned
-- migration, so it applies to hosted projects too. This file only seeds demo
-- rows and runs only via `supabase db reset` (local); seeds are never applied to
-- a hosted project. Delete this file to remove the demo.
--
-- Sign in at /auth/ as any of these users (password for all: password123):
--   alice@example.com
--   bob@example.com
--   carol@example.com
--
-- Expected access control: each user sees and manages only their own profile,
-- lists, tasks, and task history. There are intentionally no teams or shared
-- resources in this demo schema — it is a verification that RLS (and therefore
-- the agent SQL runtime) isolates one authenticated user's data from another's.
--
-- Because the tables now exist before the seed runs (created by the migration),
-- these are ordinary statements — no DO block is required.
-- =============================================================================

-- Test auth users (fixed UUIDs so the rows below can reference them).
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

-- ---------------------------------------------------------------------------
-- Demo rows: same shape for each user, different content and priorities.
-- ---------------------------------------------------------------------------
insert into public.profiles (user_id, display_name, timezone) values
  ('11111111-1111-4111-8111-111111111111', 'Alice Chen', 'Australia/Brisbane'),
  ('22222222-2222-4222-8222-222222222222', 'Bob Smith', 'America/Los_Angeles'),
  ('33333333-3333-4333-8333-333333333333', 'Carol Diaz', 'Europe/London')
on conflict do nothing;

insert into public.task_lists (id, user_id, name, color, position) values
  ('11111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Inbox', 'slate', 1),
  ('11111111-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Product Launch', 'orange', 2),
  ('22222222-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Inbox', 'slate', 1),
  ('22222222-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Home Renovation', 'blue', 2),
  ('33333333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Inbox', 'slate', 1),
  ('33333333-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Research Sprint', 'green', 2)
on conflict do nothing;

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
   '', 'done', 'low', current_date - 2, 20, array['admin'], 3, now())
on conflict do nothing;

insert into public.task_events (user_id, task_id, event_type, body, metadata) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1000-4000-8000-000000000001',
   'created', 'Task created from launch planning notes.', '{"source":"seed"}'),
  ('11111111-1111-4111-8111-111111111111', '11111111-1000-4000-8000-000000000001',
   'status_changed', 'Moved from todo to in_progress.', '{"from":"todo","to":"in_progress"}'),
  ('22222222-2222-4222-8222-222222222222', '22222222-1000-4000-8000-000000000002',
   'commented', 'Waiting on callback before scheduling work.', '{"source":"seed"}'),
  ('33333333-3333-4333-8333-333333333333', '33333333-1000-4000-8000-000000000001',
   'created', 'Imported from interview synthesis plan.', '{"source":"seed"}');
