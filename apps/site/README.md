# Site

This workspace app is a deployable React example for the
`SaxonF/templates/headless-app` template. It keeps the template's
Supabase project structure and authorization screens, then customizes the site
experience in `src/`.

The frontend is a static app intended for Vercel. The Supabase backend in
`supabase/` is deployed separately.

The homepage links to the repository template instead of serving a generated zip
archive. Future template browsing or composition features should live here,
leaving the root package focused on publishing the registry.

## Local Development

Prerequisites: Docker, Supabase CLI 2.90.0 or later, Node.js 20.19 or later,
and pnpm.

1. Start Supabase and reset the local database:

   ```bash
   supabase start
   supabase db reset
   ```

2. Create the local Edge Function env file:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   ```

3. Serve the MCP Edge Function:

   ```bash
   supabase functions serve mcp-server --env-file supabase/functions/.env
   ```

   The demo function config names the MCP server `tasks` and describes it as
   task-database access so MCP clients do not show the generic
   `supabase-agent` label.

4. Serve the React app in another terminal:

   ```bash
   pnpm --filter @saxonf/site dev
   ```

5. Open `http://127.0.0.1:3000`.

The React app defaults to the local Supabase URL and publishable key for this
demo. Override these in `.env.local` when needed:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54331
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_MCP_SERVER_URL=http://127.0.0.1:54331/functions/v1/mcp-server
VITE_MCP_SERVER_NAME=tasks
VITE_MCP_SERVER_DESCRIPTION="MCP access to the tasks database for the signed-in user."
```

The local seed includes individual task-management data for three test users.
Each user has isolated `profiles`, `task_lists`, `tasks`, and `task_events`
rows protected by RLS; there are no teams or shared rows in the demo schema.
All test users use the password `password123`:

- `alice@example.com`
- `bob@example.com`
- `carol@example.com`

The demo app uses a separate local Supabase port range so it can run beside a
default Supabase project: API `54331`, database `54332`, Studio `54333`, email
testing `54334`, analytics `54337`, and pooler `54339`.

Use `127.0.0.1` consistently. The Supabase OAuth issuer, resource, audience,
and redirect comparisons are exact.

## Deploying to a Hosted Supabase Project

1. Link this folder to the target project:

   ```bash
   supabase link --project-ref <project-ref>
   ```

2. Push migrations and auth config:

   ```bash
   supabase db push
   supabase config push   # enables the access-token hook + OAuth server
   ```

3. Set a password on the executor role (the seed file is local-only and never
   runs on hosted projects):

   ```bash
   supabase db query --linked "alter role mcp_sql_executor with password '<STRONG_PASSWORD>';"
   ```

4. Set function secrets. Copy the **Transaction pooler** host from Dashboard →
   Project Settings → Database (it looks like
   `aws-0-ap-southeast-2.pooler.supabase.com`, not `<region>.pooler.supabase.com`).
   The username must include the project ref:
   `mcp_sql_executor.<PROJECT_REF>`.

   ```bash
   supabase secrets set \
     MCP_DB_URL="postgresql://mcp_sql_executor.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
     MCP_RESOURCE_URL="https://<project-ref>.supabase.co/functions/v1/mcp-server" \
     MCP_AUTH_ISSUER="https://<project-ref>.supabase.co/auth/v1" \
     MCP_SERVER_NAME="tasks" \
     MCP_SERVER_DESCRIPTION="MCP access to the tasks database for the signed-in user."
   ```

   `MCP_RESOURCE_URL` and `MCP_AUTH_ISSUER` are required on hosted Supabase.
   Without them, OAuth discovery advertises internal Edge Runtime URLs and MCP
   clients fail with "No authorization support detected".

5. Deploy the function:

   ```bash
   supabase functions deploy mcp-server
   ```

6. In Dashboard → Authentication → URL Configuration, set **Site URL** to your
   deployed frontend origin (e.g. your Vercel URL). Add the same origin to
   **Redirect URLs** if OAuth sign-in fails.

7. Configure the Vercel project environment:

   ```bash
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
   VITE_MCP_SERVER_URL=https://<project-ref>.supabase.co/functions/v1/mcp-server
   VITE_MCP_SERVER_NAME=tasks
   VITE_MCP_SERVER_DESCRIPTION="MCP access to the tasks database for the signed-in user."
   ```

8. Deploy the frontend to Vercel from this workspace package:

   ```bash
   pnpm --filter @saxonf/site build
   ```

   `vercel.json` publishes the generated `dist/` folder. Configure the Vercel
   project root as `apps/site`.
