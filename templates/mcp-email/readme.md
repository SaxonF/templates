# MCP Email

An MCP tool pack that lets an agent send transactional email. It plugs into
[`mcp-server`](../mcp-server) the same way [`mcp-sql`](../mcp-sql) and
[`mcp-functions`](../mcp-functions) do: named, schema-validated tools registered
against the user-scoped Supabase client.

The capability ships with its own backing pipeline (queue + worker + Resend
delivery + status webhook), so the tool only ever *enqueues* — it never talks to
Resend directly.

## Tools

| Tool | Description | Safety |
| --- | --- | --- |
| `send_email` | Queue a transactional email (delivered asynchronously). Returns the email id. | Not read-only, not destructive, open-world (calls Resend). |
| `get_email_status` | Look up delivery status for the caller's own emails. | Read-only. |

## How it works

1. `send_email` calls the `enqueue_email` RPC, which inserts into
   `public.email_messages` with `created_by = auth.uid()` and pushes a job onto
   the `email_jobs` queue.
2. `pg_cron` invokes the `send-email` worker with queued jobs.
3. The worker calls Resend and updates the row to `sent` or `failed`.
4. `resend-webhook` reconciles delivery status from Resend webhooks.
5. `get_email_status` reads `public.email_messages`, which RLS scopes to
   `created_by = auth.uid()` — an agent only ever sees the signed-in user's mail.

## Recipient guardrail

An agent must not be able to email arbitrary addresses. By default `send_email`
only allows the **signed-in user's own verified address** as a recipient.
Operators can widen this with secrets:

```sh
# Allow specific domains
supabase secrets set MCP_EMAIL_ALLOWED_DOMAINS="example.com,acme.com"

# Or allow any recipient (use with care)
supabase secrets set MCP_EMAIL_ALLOW_ANY=true
```

## Configuration

```sh
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL="Acme <hello@example.com>"
```

## Includes

- `supabase/functions/mcp-server/tools/email.ts` — `send_email` + `get_email_status` tools
- `supabase/functions/mcp-server/tools/index.ts` — standalone aggregator (mcp-server + mcp-email)
- `supabase/schemas/email.sql` — email table, queue helpers, and cron dispatcher
- `supabase/functions/send-email/index.ts` — Resend worker
- `supabase/functions/resend-webhook/index.ts` — delivery status webhook
