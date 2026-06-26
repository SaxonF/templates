import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { openai } from 'npm:@ai-sdk/openai'
import { createMCPClient } from 'npm:@ai-sdk/mcp'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { streamText, stepCountIs, type ModelMessage, type ToolSet } from 'npm:ai@7'
import { z } from 'npm:zod@3'

const DEFAULT_MODEL = 'gpt-5.4-mini'
const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Use available tools when they are relevant, and cite tool results clearly.'
const MAX_HISTORY_MESSAGES = 24

const mcpServerSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1).optional(),
  headers: z.record(z.string()).optional(),
})

const requestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1),
  model: z.string().optional(),
  system: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
})

type AgentMcpServerInput = z.infer<typeof mcpServerSchema>

type AgentMcpServer = {
  name: string
  url: string
  headers?: Record<string, string>
}

type AgentMemory = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
}

// The MCP client returned by createMCPClient. We only use .tools() and .close().
type McpClient = Awaited<ReturnType<typeof createMCPClient>>

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  // The browser client reads the session id off the response, which requires
  // exposing the header for cross-origin requests.
  'Access-Control-Expose-Headers': 'X-Agent-Session-Id',
}

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { ...CORS_HEADERS, ...init.headers } })
}

function corsJson(data: unknown, init: ResponseInit = {}): Response {
  return corsResponse(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse(null, { status: 204 })
  }

  if (req.method !== 'POST') {
    return corsResponse('expected POST request', { status: 405 })
  }

  const parseResult = requestSchema.safeParse(await req.json())

  if (!parseResult.success) {
    return corsResponse(`invalid request body: ${parseResult.error.message}`, { status: 400 })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    return corsJson({ error: 'valid user JWT is required' }, { status: 401 })
  }

  const body = parseResult.data
  const sessionId = await getOrCreateSession(serviceClient, {
    sessionId: body.sessionId,
    userId: user.id,
    title: body.message.slice(0, 80),
    metadata: body.metadata ?? {},
  })

  if (!sessionId) {
    return corsJson({ error: 'session not found or not owned by user' }, { status: 404 })
  }

  await serviceClient.from('agent_memories').insert({
    session_id: sessionId,
    role: 'user',
    content: body.message,
    state: body.metadata ?? {},
  })

  const history = await loadHistory(serviceClient, sessionId)

  let mcpServers: AgentMcpServer[]
  try {
    mcpServers = await loadMcpServers(serviceClient, body.mcpServers, authHeader)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return corsJson({ error: message }, { status: 400 })
  }

  // Connect to each MCP server with the AI SDK's MCP client over Streamable
  // HTTP. The caller's JWT is forwarded in the Authorization header, which the
  // mcp-server framework accepts via its first-party auth path.
  const { tools, clients } = await buildMcpTools(mcpServers)

  const result = streamText({
    model: openai(body.model ?? Deno.env.get('OPENAI_MODEL') ?? DEFAULT_MODEL),
    system: body.system ?? DEFAULT_SYSTEM_PROMPT,
    messages: toModelMessages(history),
    tools,
    stopWhen: stepCountIs(5),
  })

  const encoder = new TextEncoder()
  let assistantText = ''

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            assistantText += part.text
            controller.enqueue(encoder.encode(part.text))
          } else if (part.type === 'error') {
            const message = part.error instanceof Error ? part.error.message : String(part.error)
            console.error('agent stream error:', message)
            const errorText = `\n\nError: ${message}`
            assistantText += errorText
            controller.enqueue(encoder.encode(errorText))
          }
        }

        await serviceClient.from('agent_memories').insert({
          session_id: sessionId,
          role: 'assistant',
          content: assistantText,
          state: { model: body.model ?? Deno.env.get('OPENAI_MODEL') ?? DEFAULT_MODEL },
        })

        controller.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('agent stream failed:', message)
        controller.enqueue(encoder.encode(`\n\nError: ${message}`))
        controller.close()
      } finally {
        await closeMcpClients(clients)
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Agent-Session-Id': sessionId,
    },
  })
})

async function getOrCreateSession(
  supabase: ReturnType<typeof createClient>,
  {
    sessionId,
    userId,
    title,
    metadata,
  }: {
    sessionId?: string
    userId: string
    title: string
    metadata: Record<string, unknown>
  }
) {
  if (sessionId) {
    const { data } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single()

    return data?.id ?? null
  }

  const { data, error } = await supabase
    .from('agent_sessions')
    .insert({ user_id: userId, title, metadata })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`failed to create agent session: ${error?.message ?? 'unknown error'}`)
  }

  return data.id as string
}

async function loadHistory(
  supabase: ReturnType<typeof createClient>,
  sessionId: string
): Promise<AgentMemory[]> {
  const { data, error } = await supabase
    .from('agent_memories')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES)

  if (error) {
    throw new Error(`failed to load agent history: ${error.message}`)
  }

  return (data ?? []).reverse() as AgentMemory[]
}

function toModelMessages(memories: AgentMemory[]): ModelMessage[] {
  return memories
    .filter((memory) => memory.content && memory.role !== 'tool')
    .map((memory) => ({
      role: memory.role === 'assistant' ? 'assistant' : memory.role === 'system' ? 'system' : 'user',
      content: memory.content ?? '',
    }))
}

function resolveMcpUrl(url: string): string {
  if (url.startsWith('/')) {
    return `${supabaseUrl}${url}`
  }

  try {
    const { pathname } = new URL(url)
    if (pathname.startsWith('/functions/v1/')) {
      return `${supabaseUrl}${pathname}`
    }
  } catch {
    // Not an absolute URL — leave as-is.
  }

  return url
}

function mergeMcpHeaders(
  configured: Record<string, string> | undefined,
  authHeader: string
): Record<string, string> | undefined {
  if (!authHeader) return configured

  return {
    ...(configured ?? {}),
    Authorization: configured?.Authorization ?? authHeader,
  }
}

async function loadMcpServers(
  supabase: ReturnType<typeof createClient>,
  requestServers: AgentMcpServerInput[] | undefined,
  authHeader: string
): Promise<AgentMcpServer[]> {
  const { data } = await supabase
    .from('agent_mcp_servers')
    .select('name, url, headers')
    .eq('enabled', true)

  const configuredServers = (data ?? []).map((server) => ({
    name: String(server.name),
    url: String(server.url),
    headers: normalizeHeaders(server.headers),
  }))

  const configuredByName = new Map(configuredServers.map((server) => [server.name, server]))

  const resolvedRequestServers = (requestServers ?? []).map((server) => {
    if (server.url) {
      return { name: server.name, url: server.url, headers: server.headers }
    }

    const configured = configuredByName.get(server.name)
    if (!configured) {
      throw new Error(`unknown MCP server: ${server.name}`)
    }

    return {
      name: server.name,
      url: configured.url,
      headers: server.headers ?? configured.headers,
    }
  })

  const defaultProjectServer: AgentMcpServer = {
    name: 'project',
    url: `${supabaseUrl}/functions/v1/mcp-server`,
  }

  return dedupeServers([
    defaultProjectServer,
    ...configuredServers,
    ...resolvedRequestServers,
  ]).map((server) => ({
    ...server,
    url: resolveMcpUrl(server.url),
    headers: mergeMcpHeaders(server.headers, authHeader),
  }))
}

async function buildMcpTools(
  servers: AgentMcpServer[]
): Promise<{ tools: ToolSet; clients: McpClient[] }> {
  const clients: McpClient[] = []

  const toolSets = await Promise.all(
    servers.map(async (server) => {
      try {
        const client = await createMCPClient({
          transport: {
            type: 'http',
            url: server.url,
            headers: server.headers ?? {},
          },
        })
        clients.push(client)

        const serverTools = await client.tools()
        // Namespace tools as `<server>_<tool>` so multiple servers cannot collide.
        return Object.fromEntries(
          Object.entries(serverTools).map(([name, definition]) => [
            toAiToolName(server.name, name),
            definition,
          ])
        ) as ToolSet
      } catch (error) {
        console.error(`failed to load MCP tools from ${server.name}:`, error)
        return {} as ToolSet
      }
    })
  )

  const tools = Object.assign({}, ...toolSets) as ToolSet

  if (Object.keys(tools).length === 0 && servers.length > 0) {
    console.error('agent-chat: no MCP tools loaded', { servers: servers.map((server) => server.name) })
  }

  return { tools, clients }
}

async function closeMcpClients(clients: McpClient[]): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()))
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, headerValue]) => [key, headerValue])
  )
}

function dedupeServers(servers: AgentMcpServer[]): AgentMcpServer[] {
  const seen = new Set<string>()
  return servers.filter((server) => {
    const key = server.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toAiToolName(serverName: string, toolName: string) {
  return `${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_')
}
