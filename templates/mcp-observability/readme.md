# MCP Observability

Adds lightweight operational tools for agents.

## Tools

| Tool | Purpose |
| --- | --- |
| `write_app_log` | Write a structured user-scoped log event. |
| `list_app_logs` | Read recent user-scoped log events. |
| `list_failed_workflows` | Inspect recent failed/dead-letter workflow runs. |

This template pairs with **observability-logs** and **mcp-workflows**. It
does not expose secrets, raw environment variables, or unrestricted platform
logs.

## Dependencies

Requires **mcp-server**, **observability-logs**, and **mcp-workflows**.
