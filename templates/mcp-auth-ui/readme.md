# MCP Auth UI

The vanilla front-end for the [mcp-server](../mcp-server) OAuth flow. These are
static pages served from `public/` — no build step, no framework.

## Pages

| Path | Purpose |
| --- | --- |
| `public/setup/` | First-run setup wizard. |
| `public/auth/` | Sign-in. |
| `public/oauth/consent/` | OAuth consent screen. Referenced by `config.toml` → `[auth.oauth_server] authorization_url_path = "/oauth/consent/"`. |
| `public/clients/` | Manage dynamically-registered OAuth clients. |
| `public/config.js` | Front-end config: `SUPABASE_URL`, publishable key, `MCP_SERVER_URL/NAME/DESCRIPTION`. Edit for your project. |

## Requirements

This template depends on **mcp-server**, which provides the auth configuration
these screens rely on:

- `[auth.oauth_server]` enabled with `authorization_url_path = "/oauth/consent/"`
- The custom access-token hook (audience binding)
- `auth.additional_redirect_urls` for your front-end origin

When installed via the [headless-app](../headless-app) block, that config is
already merged. Standalone, ensure `mcp-server`'s `config.toml` is in place and
update `public/config.js` with your project URL and publishable key.

## Dependencies

Requires [mcp-server](../mcp-server). Pairs with [mcp-sql](../mcp-sql) and the
[agent](../agent); all three are bundled by the [headless-app](../headless-app)
block.
