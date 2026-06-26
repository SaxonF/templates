
  create table "public"."profiles" (
    "user_id" uuid not null,
    "display_name" text not null,
    "timezone" text not null default 'UTC'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."profiles" enable row level security;


  create table "public"."task_events" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "task_id" uuid not null,
    "event_type" text not null,
    "body" text not null default ''::text,
    "metadata" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."task_events" enable row level security;


  create table "public"."task_lists" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "name" text not null,
    "color" text not null default 'slate'::text,
    "position" integer not null default 0,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."task_lists" enable row level security;


  create table "public"."tasks" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "list_id" uuid not null,
    "title" text not null,
    "description" text not null default ''::text,
    "status" text not null default 'todo'::text,
    "priority" text not null default 'medium'::text,
    "due_on" date,
    "estimate_minutes" integer,
    "completed_at" timestamp with time zone,
    "tags" text[] not null default '{}'::text[],
    "position" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."tasks" enable row level security;

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (user_id);

CREATE UNIQUE INDEX task_events_pkey ON public.task_events USING btree (id);

CREATE INDEX task_events_task_created_idx ON public.task_events USING btree (user_id, task_id, created_at DESC);

CREATE UNIQUE INDEX task_lists_id_user_id_key ON public.task_lists USING btree (id, user_id);

CREATE UNIQUE INDEX task_lists_pkey ON public.task_lists USING btree (id);

CREATE UNIQUE INDEX task_lists_user_id_name_key ON public.task_lists USING btree (user_id, name);

CREATE INDEX task_lists_user_position_idx ON public.task_lists USING btree (user_id, archived_at, "position");

CREATE UNIQUE INDEX tasks_id_user_id_key ON public.tasks USING btree (id, user_id);

CREATE UNIQUE INDEX tasks_pkey ON public.tasks USING btree (id);

CREATE INDEX tasks_user_priority_idx ON public.tasks USING btree (user_id, priority, created_at DESC);

CREATE INDEX tasks_user_status_due_idx ON public.tasks USING btree (user_id, status, due_on);

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."task_events" add constraint "task_events_pkey" PRIMARY KEY using index "task_events_pkey";

alter table "public"."task_lists" add constraint "task_lists_pkey" PRIMARY KEY using index "task_lists_pkey";

alter table "public"."tasks" add constraint "tasks_pkey" PRIMARY KEY using index "tasks_pkey";

alter table "public"."profiles" add constraint "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_user_id_fkey";

alter table "public"."task_events" add constraint "task_events_event_type_check" CHECK ((event_type = ANY (ARRAY['created'::text, 'commented'::text, 'status_changed'::text, 'due_date_changed'::text, 'completed'::text]))) not valid;

alter table "public"."task_events" validate constraint "task_events_event_type_check";

alter table "public"."task_events" add constraint "task_events_task_id_user_id_fkey" FOREIGN KEY (task_id, user_id) REFERENCES public.tasks(id, user_id) ON DELETE CASCADE not valid;

alter table "public"."task_events" validate constraint "task_events_task_id_user_id_fkey";

alter table "public"."task_events" add constraint "task_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."task_events" validate constraint "task_events_user_id_fkey";

alter table "public"."task_lists" add constraint "task_lists_id_user_id_key" UNIQUE using index "task_lists_id_user_id_key";

alter table "public"."task_lists" add constraint "task_lists_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."task_lists" validate constraint "task_lists_user_id_fkey";

alter table "public"."task_lists" add constraint "task_lists_user_id_name_key" UNIQUE using index "task_lists_user_id_name_key";

alter table "public"."tasks" add constraint "tasks_estimate_minutes_check" CHECK (((estimate_minutes IS NULL) OR (estimate_minutes >= 0))) not valid;

alter table "public"."tasks" validate constraint "tasks_estimate_minutes_check";

alter table "public"."tasks" add constraint "tasks_id_user_id_key" UNIQUE using index "tasks_id_user_id_key";

alter table "public"."tasks" add constraint "tasks_list_id_user_id_fkey" FOREIGN KEY (list_id, user_id) REFERENCES public.task_lists(id, user_id) ON DELETE CASCADE not valid;

alter table "public"."tasks" validate constraint "tasks_list_id_user_id_fkey";

alter table "public"."tasks" add constraint "tasks_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_priority_check";

alter table "public"."tasks" add constraint "tasks_status_check" CHECK ((status = ANY (ARRAY['backlog'::text, 'todo'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'canceled'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_status_check";

alter table "public"."tasks" add constraint "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."tasks" validate constraint "tasks_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."task_events" to "anon";

grant insert on table "public"."task_events" to "anon";

grant references on table "public"."task_events" to "anon";

grant select on table "public"."task_events" to "anon";

grant trigger on table "public"."task_events" to "anon";

grant truncate on table "public"."task_events" to "anon";

grant update on table "public"."task_events" to "anon";

grant delete on table "public"."task_events" to "authenticated";

grant insert on table "public"."task_events" to "authenticated";

grant references on table "public"."task_events" to "authenticated";

grant select on table "public"."task_events" to "authenticated";

grant trigger on table "public"."task_events" to "authenticated";

grant truncate on table "public"."task_events" to "authenticated";

grant update on table "public"."task_events" to "authenticated";

grant delete on table "public"."task_events" to "service_role";

grant insert on table "public"."task_events" to "service_role";

grant references on table "public"."task_events" to "service_role";

grant select on table "public"."task_events" to "service_role";

grant trigger on table "public"."task_events" to "service_role";

grant truncate on table "public"."task_events" to "service_role";

grant update on table "public"."task_events" to "service_role";

grant delete on table "public"."task_lists" to "anon";

grant insert on table "public"."task_lists" to "anon";

grant references on table "public"."task_lists" to "anon";

grant select on table "public"."task_lists" to "anon";

grant trigger on table "public"."task_lists" to "anon";

grant truncate on table "public"."task_lists" to "anon";

grant update on table "public"."task_lists" to "anon";

grant delete on table "public"."task_lists" to "authenticated";

grant insert on table "public"."task_lists" to "authenticated";

grant references on table "public"."task_lists" to "authenticated";

grant select on table "public"."task_lists" to "authenticated";

grant trigger on table "public"."task_lists" to "authenticated";

grant truncate on table "public"."task_lists" to "authenticated";

grant update on table "public"."task_lists" to "authenticated";

grant delete on table "public"."task_lists" to "service_role";

grant insert on table "public"."task_lists" to "service_role";

grant references on table "public"."task_lists" to "service_role";

grant select on table "public"."task_lists" to "service_role";

grant trigger on table "public"."task_lists" to "service_role";

grant truncate on table "public"."task_lists" to "service_role";

grant update on table "public"."task_lists" to "service_role";

grant delete on table "public"."tasks" to "anon";

grant insert on table "public"."tasks" to "anon";

grant references on table "public"."tasks" to "anon";

grant select on table "public"."tasks" to "anon";

grant trigger on table "public"."tasks" to "anon";

grant truncate on table "public"."tasks" to "anon";

grant update on table "public"."tasks" to "anon";

grant delete on table "public"."tasks" to "authenticated";

grant insert on table "public"."tasks" to "authenticated";

grant references on table "public"."tasks" to "authenticated";

grant select on table "public"."tasks" to "authenticated";

grant trigger on table "public"."tasks" to "authenticated";

grant truncate on table "public"."tasks" to "authenticated";

grant update on table "public"."tasks" to "authenticated";

grant delete on table "public"."tasks" to "service_role";

grant insert on table "public"."tasks" to "service_role";

grant references on table "public"."tasks" to "service_role";

grant select on table "public"."tasks" to "service_role";

grant trigger on table "public"."tasks" to "service_role";

grant truncate on table "public"."tasks" to "service_role";

grant update on table "public"."tasks" to "service_role";


  create policy "users manage their own profile"
  on "public"."profiles"
  as permissive
  for all
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "users manage their own task events"
  on "public"."task_events"
  as permissive
  for all
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "users manage their own task lists"
  on "public"."task_lists"
  as permissive
  for all
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "users manage their own tasks"
  on "public"."tasks"
  as permissive
  for all
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((user_id = ( SELECT auth.uid() AS uid)));


CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER task_lists_set_updated_at BEFORE UPDATE ON public.task_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


