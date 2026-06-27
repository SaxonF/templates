import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { errorResult, jsonResult, runtimeErrorResult } from "./result.ts";

type Organization = {
  id: string;
  name: string;
  slug: string;
  created_at: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

export function registerTenancyTools(
  server: McpServer,
  { supabase }: ToolContext,
): void {
  server.registerTool(
    "list_organizations",
    {
      description:
        "List organizations visible to the signed-in user through multi-tenant RBAC policies.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { limit: number; offset: number }) => {
      try {
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name, slug, created_at")
          .order("name", { ascending: true })
          .range(input.offset, input.offset + input.limit - 1);
        if (error) return errorResult(error.message);
        return jsonResult({ organizations: data ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "resolve_organization",
    {
      description:
        "Resolve an organization visible to the signed-in user by id, slug, or name text.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).default(10),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { query: string; limit: number }) => {
      try {
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name, slug, created_at")
          .order("name", { ascending: true })
          .limit(100);
        if (error) return errorResult(error.message);

        const needle = input.query.toLowerCase();
        const matches = ((data ?? []) as Organization[])
          .filter((organization) =>
            text(organization.id) === needle ||
            text(organization.slug) === needle ||
            text(organization.name).includes(needle)
          )
          .slice(0, input.limit);

        return jsonResult({ query: input.query, organizations: matches });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_organization_members",
    {
      description:
        "List visible organization memberships for one organization. RBAC policies apply.",
      inputSchema: {
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (
      input: { organizationId: string; limit: number; offset: number },
    ) => {
      try {
        const { data, error } = await supabase
          .from("organization_members")
          .select("id, organization_id, user_id, role, created_at")
          .eq("organization_id", input.organizationId)
          .order("created_at", { ascending: true })
          .range(input.offset, input.offset + input.limit - 1);
        if (error) return errorResult(error.message);
        return jsonResult({ organizationId: input.organizationId, members: data ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "check_organization_permission",
    {
      description:
        "Check whether the signed-in user has one multi-tenant RBAC permission in an organization.",
      inputSchema: {
        organizationId: z.string().uuid(),
        permission: z.string().min(1).describe(
          "Permission enum value, for example projects.create or members.invite.",
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { organizationId: string; permission: string }) => {
      try {
        const { data, error } = await supabase.rpc("authorize", {
          requested_organization_id: input.organizationId,
          requested_permission: input.permission,
        });
        if (error) return errorResult(error.message);
        return jsonResult({
          organizationId: input.organizationId,
          permission: input.permission,
          allowed: Boolean(data),
        });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
