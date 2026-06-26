export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() || 'http://127.0.0.1:54331'

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

export const MCP_SERVER_URL =
  import.meta.env.VITE_MCP_SERVER_URL?.trim() || `${SUPABASE_URL}/functions/v1/mcp-server`

export const MCP_SERVER_NAME = import.meta.env.VITE_MCP_SERVER_NAME?.trim() || 'tasks'

export const MCP_SERVER_DESCRIPTION =
  import.meta.env.VITE_MCP_SERVER_DESCRIPTION?.trim() ||
  'MCP access to the tasks database for the signed-in user.'

export const BACKPLANE_REPOSITORY_URL =
  import.meta.env.VITE_BACKPLANE_REPOSITORY_URL?.trim() ||
  'https://github.com/SaxonF/templates'

export const TEMPLATE_REPOSITORY_URL =
  import.meta.env.VITE_TEMPLATE_REPOSITORY_URL?.trim() ||
  'https://github.com/SaxonF/templates/tree/main/templates/headless-app'

export const configError =
  !SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_')
    ? 'Set VITE_SUPABASE_PUBLISHABLE_KEY before using this page.'
    : null

