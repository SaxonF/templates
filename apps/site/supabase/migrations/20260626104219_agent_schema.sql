  create table "public"."agent_mcp_servers" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "url" text not null,
    "headers" jsonb not null default '{}'::jsonb,
    "enabled" boolean not null default true,
    "metadata" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."agent_mcp_servers" enable row level security;


  create table "public"."agent_memories" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid not null,
    "role" text not null,
    "content" text,
    "state" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."agent_memories" enable row level security;


  create table "public"."agent_sessions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "title" text,
    "metadata" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."agent_sessions" enable row level security;

CREATE UNIQUE INDEX agent_mcp_servers_name_key ON public.agent_mcp_servers USING btree (name);

CREATE UNIQUE INDEX agent_mcp_servers_pkey ON public.agent_mcp_servers USING btree (id);

CREATE UNIQUE INDEX agent_memories_pkey ON public.agent_memories USING btree (id);

CREATE INDEX agent_memories_session_id_idx ON public.agent_memories USING btree (session_id);

CREATE UNIQUE INDEX agent_sessions_pkey ON public.agent_sessions USING btree (id);

alter table "public"."agent_mcp_servers" add constraint "agent_mcp_servers_pkey" PRIMARY KEY using index "agent_mcp_servers_pkey";

alter table "public"."agent_memories" add constraint "agent_memories_pkey" PRIMARY KEY using index "agent_memories_pkey";

alter table "public"."agent_sessions" add constraint "agent_sessions_pkey" PRIMARY KEY using index "agent_sessions_pkey";

alter table "public"."agent_mcp_servers" add constraint "agent_mcp_servers_name_key" UNIQUE using index "agent_mcp_servers_name_key";

alter table "public"."agent_memories" add constraint "agent_memories_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text]))) not valid;

alter table "public"."agent_memories" validate constraint "agent_memories_role_check";

alter table "public"."agent_memories" add constraint "agent_memories_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE CASCADE not valid;

alter table "public"."agent_memories" validate constraint "agent_memories_session_id_fkey";

alter table "public"."agent_sessions" add constraint "agent_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."agent_sessions" validate constraint "agent_sessions_user_id_fkey";

grant delete on table "public"."agent_mcp_servers" to "anon";

grant insert on table "public"."agent_mcp_servers" to "anon";

grant references on table "public"."agent_mcp_servers" to "anon";

grant select on table "public"."agent_mcp_servers" to "anon";

grant trigger on table "public"."agent_mcp_servers" to "anon";

grant truncate on table "public"."agent_mcp_servers" to "anon";

grant update on table "public"."agent_mcp_servers" to "anon";

grant delete on table "public"."agent_mcp_servers" to "authenticated";

grant insert on table "public"."agent_mcp_servers" to "authenticated";

grant references on table "public"."agent_mcp_servers" to "authenticated";

grant select on table "public"."agent_mcp_servers" to "authenticated";

grant trigger on table "public"."agent_mcp_servers" to "authenticated";

grant truncate on table "public"."agent_mcp_servers" to "authenticated";

grant update on table "public"."agent_mcp_servers" to "authenticated";

grant delete on table "public"."agent_mcp_servers" to "service_role";

grant insert on table "public"."agent_mcp_servers" to "service_role";

grant references on table "public"."agent_mcp_servers" to "service_role";

grant select on table "public"."agent_mcp_servers" to "service_role";

grant trigger on table "public"."agent_mcp_servers" to "service_role";

grant truncate on table "public"."agent_mcp_servers" to "service_role";

grant update on table "public"."agent_mcp_servers" to "service_role";

grant delete on table "public"."agent_memories" to "anon";

grant insert on table "public"."agent_memories" to "anon";

grant references on table "public"."agent_memories" to "anon";

grant select on table "public"."agent_memories" to "anon";

grant trigger on table "public"."agent_memories" to "anon";

grant truncate on table "public"."agent_memories" to "anon";

grant update on table "public"."agent_memories" to "anon";

grant delete on table "public"."agent_memories" to "authenticated";

grant insert on table "public"."agent_memories" to "authenticated";

grant references on table "public"."agent_memories" to "authenticated";

grant select on table "public"."agent_memories" to "authenticated";

grant trigger on table "public"."agent_memories" to "authenticated";

grant truncate on table "public"."agent_memories" to "authenticated";

grant update on table "public"."agent_memories" to "authenticated";

grant delete on table "public"."agent_memories" to "service_role";

grant insert on table "public"."agent_memories" to "service_role";

grant references on table "public"."agent_memories" to "service_role";

grant select on table "public"."agent_memories" to "service_role";

grant trigger on table "public"."agent_memories" to "service_role";

grant truncate on table "public"."agent_memories" to "service_role";

grant update on table "public"."agent_memories" to "service_role";

grant delete on table "public"."agent_sessions" to "anon";

grant insert on table "public"."agent_sessions" to "anon";

grant references on table "public"."agent_sessions" to "anon";

grant select on table "public"."agent_sessions" to "anon";

grant trigger on table "public"."agent_sessions" to "anon";

grant truncate on table "public"."agent_sessions" to "anon";

grant update on table "public"."agent_sessions" to "anon";

grant delete on table "public"."agent_sessions" to "authenticated";

grant insert on table "public"."agent_sessions" to "authenticated";

grant references on table "public"."agent_sessions" to "authenticated";

grant select on table "public"."agent_sessions" to "authenticated";

grant trigger on table "public"."agent_sessions" to "authenticated";

grant truncate on table "public"."agent_sessions" to "authenticated";

grant update on table "public"."agent_sessions" to "authenticated";

grant delete on table "public"."agent_sessions" to "service_role";

grant insert on table "public"."agent_sessions" to "service_role";

grant references on table "public"."agent_sessions" to "service_role";

grant select on table "public"."agent_sessions" to "service_role";

grant trigger on table "public"."agent_sessions" to "service_role";

grant truncate on table "public"."agent_sessions" to "service_role";

grant update on table "public"."agent_sessions" to "service_role";


  create policy "Authenticated users can read enabled MCP servers"
  on "public"."agent_mcp_servers"
  as permissive
  for select
  to authenticated
using ((enabled = true));



  create policy "Users can insert memories in their sessions"
  on "public"."agent_memories"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.agent_sessions
  WHERE ((agent_sessions.id = agent_memories.session_id) AND (agent_sessions.user_id = auth.uid())))));



  create policy "Users can read memories in their sessions"
  on "public"."agent_memories"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.agent_sessions
  WHERE ((agent_sessions.id = agent_memories.session_id) AND (agent_sessions.user_id = auth.uid())))));



  create policy "Users can delete their own sessions"
  on "public"."agent_sessions"
  as permissive
  for delete
  to authenticated
using ((auth.uid() = user_id));



  create policy "Users can insert their own sessions"
  on "public"."agent_sessions"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = user_id));



  create policy "Users can read their own sessions"
  on "public"."agent_sessions"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));



  create policy "Users can update their own sessions"
  on "public"."agent_sessions"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id));
