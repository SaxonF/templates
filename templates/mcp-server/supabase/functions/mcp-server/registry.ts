import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type JsonSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolContext = {
  /** Service-role client. Bypasses RLS — use only for admin or schema introspection. */
  supabase: SupabaseClient
  /** User-scoped client from the request Authorization header. Use for RLS-protected tables. */
  userSupabase: SupabaseClient | null
  request: Request
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>

export type Tool = {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: ToolHandler
}

const tools = new Map<string, Tool>()

export function registerTool(tool: Tool): void {
  if (tools.has(tool.name)) {
    throw new Error(`tool already registered: ${tool.name}`)
  }
  tools.set(tool.name, tool)
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name)
}

export function listTools(): Tool[] {
  return Array.from(tools.values())
}
