import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { jsonResult, runtimeErrorResult, errorResult } from "./result.ts";

// Transactional email tools for the agent.
//
// These plug into mcp-server exactly like mcp-sql / mcp-functions: a pair of
// named, schema-validated tools registered against the user-scoped Supabase
// client. The heavy lifting (queue, worker, Resend delivery, status webhook)
// lives in the backing pipeline shipped by this template
// (supabase/schemas/email.sql + the send-email / resend-webhook functions).
//
// `send_email` only enqueues — it calls the SECURITY DEFINER `enqueue_email`
// RPC, which stamps `created_by = auth.uid()` from the caller's JWT. The cron
// worker then delivers via Resend. `get_email_status` reads back the caller's
// own messages, which RLS already scopes to `created_by = auth.uid()`.

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Recipient guardrail. An agent must not be able to send mail to arbitrary
 * addresses, so by default we only allow the signed-in user's own verified
 * email. Operators can widen this with env config:
 *   - MCP_EMAIL_ALLOW_ANY=true            → allow any recipient (use with care)
 *   - MCP_EMAIL_ALLOWED_DOMAINS=a.com,b.com → allow recipients in these domains
 */
function recipientGuard(claims: Record<string, unknown>): (to: string[]) => string | null {
  const allowAny = (Deno.env.get("MCP_EMAIL_ALLOW_ANY") ?? "").toLowerCase() === "true";
  const allowedDomains = (Deno.env.get("MCP_EMAIL_ALLOWED_DOMAINS") ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  const selfEmail = typeof claims.email === "string" ? claims.email.toLowerCase() : null;

  return (recipients) => {
    if (allowAny) return null;

    for (const raw of recipients) {
      const address = raw.trim().toLowerCase();
      if (selfEmail && address === selfEmail) continue;

      const domain = address.split("@")[1] ?? "";
      if (allowedDomains.length > 0 && allowedDomains.includes(domain)) continue;

      return (
        `recipient "${raw}" is not allowed. By default an agent may only email ` +
        `the signed-in user's own address. Set MCP_EMAIL_ALLOWED_DOMAINS or ` +
        `MCP_EMAIL_ALLOW_ANY to widen this.`
      );
    }

    return null;
  };
}

export function registerEmailTools(
  server: McpServer,
  { supabase, principal }: ToolContext,
): void {
  const guard = recipientGuard(principal.claims);

  server.registerTool(
    "send_email",
    {
      description:
        "Queue a transactional email for delivery via Resend. The email is sent " +
        "asynchronously by a background worker. Returns the email id; use " +
        "get_email_status to check delivery. By default only the signed-in " +
        "user's own address may be a recipient.",
      inputSchema: {
        to: z
          .array(z.string().email())
          .min(1)
          .describe("Recipient email addresses."),
        subject: z.string().min(1).describe("Email subject line."),
        html: z.string().optional().describe("HTML body. Provide html or text."),
        text: z.string().optional().describe("Plain-text body. Provide html or text."),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Optional string key/value tags for analytics."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, subject, html, text, tags }) => {
      if (!html && !text) {
        return errorResult("provide an html or text body");
      }

      const rejection = guard(to);
      if (rejection) {
        return errorResult(rejection);
      }

      try {
        const { data, error } = await supabase.rpc("enqueue_email", {
          to_email: to,
          subject,
          html: html ?? null,
          text: text ?? null,
          tags: tags ?? {},
          max_attempts: DEFAULT_MAX_ATTEMPTS,
        });

        if (error) return runtimeErrorResult(error);

        return jsonResult({ id: data, status: "queued" });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_email_status",
    {
      description:
        "Look up delivery status for emails the signed-in user has sent. Pass an " +
        "id to fetch one message, or omit it to list the most recent.",
      inputSchema: {
        id: z.string().uuid().optional().describe("Specific email id to fetch."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Max rows when listing recent emails."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, limit }) => {
      try {
        let query = supabase
          .from("email_messages")
          .select("id, to_email, subject, status, error, sent_at, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (id) query = query.eq("id", id);

        const { data, error } = await query;
        if (error) return runtimeErrorResult(error);

        return jsonResult(data ?? []);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
