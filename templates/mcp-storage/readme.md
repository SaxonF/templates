# MCP Storage

Adds Supabase Storage tools to the MCP server.

The tools use the signed-in user's Supabase client. Bucket policies and Storage
RLS remain the authorization boundary.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_storage_objects` | List objects under a bucket prefix. |
| `create_signed_download_url` | Create a short-lived download URL. |
| `create_signed_upload_url` | Create a short-lived upload URL. |
| `move_storage_object` | Move/rename one object. |
| `copy_storage_object` | Copy one object. |
| `delete_storage_objects` | Delete up to 50 objects. |

## Composition

When this is the only tool template, its `tools/index.ts` works as-is. When
several tool templates are composed, use a bundle such as **headless-app** or
manually merge the register calls into one final `tools/index.ts`.

## Dependencies

Requires **mcp-server**. Ships a `supabase/config/storage.toml` fragment to enable Storage — merge it into `supabase/config.toml`.
