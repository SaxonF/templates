# MCP Observability

Adds lightweight operational tools for agents.

## Tools

| Tool | Purpose |
| --- | --- |
| `write_app_log` | Write a structured user-scoped log event. |
| `list_app_logs` | Read recent user-scoped log events. |
| `list_failed_workflows` | Inspect recent failed/dead-letter workflow runs. |

## Includes

- `supabase/schemas/observability.sql` — user-scoped `app_logs` table and RLS

This template pairs with **mcp-workflows** for failed-run inspection. It does
not expose secrets, raw environment variables, or unrestricted platform logs.

## Dependencies

Requires **mcp-server** and **mcp-workflows**.
