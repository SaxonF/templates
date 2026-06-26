// Public browser configuration. Both values are safe to expose in a browser.
//
// LOCAL: the values below are the well-known defaults for a `supabase start`
// stack and work as-is — no edit needed.
//
// HOSTED: replace SUPABASE_URL with your project URL and SUPABASE_PUBLISHABLE_KEY
// with your project's publishable key (Project Settings → API). The auth pages
// refuse to run while the key is empty or a `YOUR_…` placeholder.
export const SUPABASE_URL = 'http://127.0.0.1:54321'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
export const MCP_SERVER_URL = `${SUPABASE_URL}/functions/v1/mcp-server`
export const MCP_SERVER_NAME = 'supabase-agent'
export const MCP_SERVER_DESCRIPTION =
  'MCP access to this Supabase database for the signed-in user.'
