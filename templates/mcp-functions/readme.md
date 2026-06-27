# MCP Functions

Scaffold for exposing Supabase Edge Functions as typed MCP tools.

This template deliberately does **not** expose a generic `invoke_function` tool.
Agents should see named, schema-validated capabilities such as `send_invite`,
`create_export`, or `charge_customer`, not a raw dispatcher that can call any
function by string.

## Includes

- `supabase/functions/mcp-server/tools/functions.ts` - app-owned registration
  file for typed Edge Function tools.
- `supabase/functions/mcp-server/tools/index.ts` - standalone aggregator for
  `mcp-server + mcp-functions`.

## Add a function tool

Edit `functions.ts` and register one tool per exposed function:

```ts
server.registerTool(
  "send_invite",
  {
    description: "Send an organization invite email.",
    inputSchema: { email: z.string().email(), organizationId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  ({ email, organizationId }) =>
    invokeEdgeFunction(context.supabase, "send-invite", { email, organizationId }),
);
```

The framework helper forwards the signed-in user's token through the user-scoped
Supabase client. The target Edge Function must still perform its own
authentication and authorization.

## Composition

When this is the only tool template, its `tools/index.ts` works as-is. When
several tool templates are composed, use a bundle such as **headless-app** or
manually merge the register calls into one final `tools/index.ts`.

## Dependencies

Requires **mcp-server** and **functions**.
