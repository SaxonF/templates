-- Default user_id to the signed-in user on the user-owned task tables.
--
-- The agent SQL runtime executes as `authenticated` with the caller's
-- auth.uid(). Without a default, an INSERT that omits user_id leaves it null,
-- which the RLS `with check (user_id = auth.uid())` policy rejects as a
-- row-level security violation. Defaulting to auth.uid() lets the agent insert
-- rows without having to know or set the user id, while the policy still blocks
-- any attempt to write a row for a different user.

alter table public.task_lists alter column user_id set default auth.uid();
alter table public.tasks alter column user_id set default auth.uid();
alter table public.task_events alter column user_id set default auth.uid();
