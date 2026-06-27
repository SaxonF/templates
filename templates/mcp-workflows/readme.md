# MCP Workflows

Adds MCP tools for the **durable-workflows** template.

Use these tools when an agent needs to kick off work that should survive request
timeouts: imports, exports, document processing, billing reconciliation, or AI
batch jobs.

## Tools

| Tool | Purpose |
| --- | --- |
| `enqueue_workflow` | Create and enqueue a workflow run. |
| `get_workflow_run` | Read one run with its steps and attempts. |
| `list_workflow_runs` | List recent user-owned runs. |
| `cancel_workflow` | Mark a queued/running/failed run as cancelled. |
| `retry_workflow` | Requeue a failed, dead-lettered, or cancelled run. |

## Security

The underlying **durable-workflows** schema stores `created_by` ownership,
uses owner-scoped read policies, and exposes cancel/retry through
`SECURITY DEFINER` RPCs that check `auth.uid()` and revoke public execution.

## Dependencies

Requires **mcp-server** and **durable-workflows**.
