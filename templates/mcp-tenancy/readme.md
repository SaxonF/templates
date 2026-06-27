# MCP Tenancy

Adds tenant-discovery tools for projects using **multi-tenant-rbac**.

Agents should not ask users to paste organization UUIDs. These tools let the
agent resolve the active tenant, list visible memberships, and check a
permission before calling more specific tools.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_organizations` | List organizations visible to the signed-in user. |
| `resolve_organization` | Match an organization by id, slug, or name text. |
| `list_organization_members` | List visible members for one organization. |
| `check_organization_permission` | Call the RBAC `authorize` helper for one permission. |

All reads go through the signed-in user's Supabase client, so the RLS policies
from **multi-tenant-rbac** apply.

## Dependencies

Requires **mcp-server** and **multi-tenant-rbac**.
