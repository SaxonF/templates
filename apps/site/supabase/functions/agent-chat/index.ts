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
// Max model steps per turn. Each tool call + the final text answer is a step, so
// a multi-step task (look up a list, create it, insert a row, then reply) can
// easily need several. Too low and the turn ends mid-tool-use with no answer.
const MAX_STEPS = 12

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

  const modelId = body.model ?? Deno.env.get('OPENAI_MODEL') ?? DEFAULT_MODEL

  console.info('agent-chat: start', {
    sessionId,
    model: modelId,
    tools: Object.keys(tools),
    historyMessages: history.length,
  })

  const result = streamText({
    model: openai(modelId),
    system: body.system ?? DEFAULT_SYSTEM_PROMPT,
    messages: toModelMessages(history),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // Without onError, model/tool failures during streaming are swallowed and
    // the client just sees an empty 200. Surface them in the logs.
    onError({ error }) {
      console.error('agent-chat: streamText error', error instanceof Error ? error.message : String(error))
    },
  })

  const encoder = new TextEncoder()
  let assistantText = ''

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let textDeltas = 0
      let toolCalls = 0
      let finishReason: string | undefined

      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            textDeltas++
            assistantText += part.text
            controller.enqueue(encoder.encode(part.text))
          } else if (part.type === 'tool-call') {
            toolCalls++
            console.info('agent-chat: tool-call', part.toolName)
          } else if (part.type === 'tool-error') {
            console.error('agent-chat: tool-error', part.toolName, String(part.error))
          } else if (part.type === 'finish') {
            finishReason = part.finishReason
          } else if (part.type === 'error') {
            const message = part.error instanceof Error ? part.error.message : String(part.error)
            console.error('agent-chat: stream error part:', message)
            const errorText = `\n\nError: ${message}`
            assistantText += errorText
            controller.enqueue(encoder.encode(errorText))
          }
        }

        console.info('agent-chat: done', {
          sessionId,
          textDeltas,
          toolCalls,
          finishReason,
          responseLength: assistantText.length,
        })

        // A finished-but-empty turn (e.g. the model stopped on tool-calls or hit
        // the step limit) would otherwise be a silent blank 200. Surface it.
        if (!assistantText) {
          console.warn('agent-chat: empty response', { sessionId, finishReason, toolCalls })
          const note =
            finishReason === 'tool-calls'
              ? 'The agent stopped while still using tools (step limit reached). Please try again or rephrase.'
              : 'The agent finished without producing a response. Please try again.'
          assistantText = note
          controller.enqueue(encoder.encode(note))
        }

        await serviceClient.from('agent_memories').insert({
          session_id: sessionId,
          role: 'assistant',
          content: assistantText,
          state: { model: modelId, finishReason: finishReason ?? null },
        })

        controller.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('agent-chat: stream failed:', message)
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
