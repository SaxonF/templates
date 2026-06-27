import { ArrowUp, Bot } from 'lucide-react'
import { useRef, useState } from 'react'

import { AuthGate } from '@/components/layout/AuthGate'
import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { MessageAnimated } from '@/components/message-animated'
import { Button } from '@/components/ui/button'
import { ShimmerMarker, Marker, MarkerContent } from '@/components/ui/marker'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/config'
import { getClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const AGENT_CHAT_URL = `${SUPABASE_URL}/functions/v1/agent-chat`

const INSTALL_COMMAND = 'npx shadcn@latest add SaxonF/templates/agent'

const SYSTEM_PROMPT = [
  'You are a task management assistant for the signed-in user.',
  'You have direct access to their tasks database through the available tools.',
  'Use those tools to create, list, update, complete, reprioritize, and delete tasks on the user’s behalf — never guess at or fabricate task data, always read it through a tool first.',
  'Data model: a task belongs to a task_list via list_id. Before creating a task, find the user’s task_lists; if none exists, create one (e.g. "Inbox") and use its id.',
  'Do not set user_id on inserts — it defaults to the current user automatically. Every action runs as the authenticated user under row-level security, so you only ever see and modify that user’s own rows.',
  'After making a change, confirm concisely what you did. Ask a brief clarifying question only when a request is genuinely ambiguous.',
].join(' ')

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function AgentPage() {
  return (
    <AuthGate activePage="agent">
      {(user) => (
        <PageShell user={user} variant="account" activePage="agent">
          <AgentContent />
        </PageShell>
      )}
    </AuthGate>
  )
}

function AgentContent() {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const messageIdRef = useRef(0)

  function nextMessageId() {
    messageIdRef.current += 1
    return `msg-${messageIdRef.current}`
  }

  async function send() {
    const prompt = message.trim()
    if (!prompt || pending) return

    const userMessageId = nextMessageId()
    const assistantMessageId = nextMessageId()

    setPending(true)
    setError(null)
    setMessage('')
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: 'user', content: prompt },
      { id: assistantMessageId, role: 'assistant', content: '' },
    ])

    try {
      const { data, error: sessionError } = await getClient().auth.getSession()
      const accessToken = data.session?.access_token

      if (sessionError || !accessToken) {
        throw new Error('Your session expired. Sign in again to use the agent.')
      }

      const res = await fetch(AGENT_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          system: SYSTEM_PROMPT,
          sessionId: sessionIdRef.current ?? undefined,
        }),
      })

      const returnedSession = res.headers.get('X-Agent-Session-Id')
      if (returnedSession) sessionIdRef.current = returnedSession

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || `Agent request failed (${res.status}).`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantMessageId ? { ...entry, content: text } : entry
          )
        )
      }
    } catch (caught) {
      setMessages((current) => current.filter((entry) => entry.id !== assistantMessageId))
      setError(caught instanceof Error ? caught.message : 'Unable to reach the agent.')
    } finally {
      setPending(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const hasMessages = messages.length > 0
  const isStreaming = pending && messages.some((entry) => entry.role === 'assistant' && entry.content)

  return (
    <PageLayout
      intro={
        <>
          <PageIntro
            title="Agent"
            titleClassName="text-base"
            lead="Built with the Agent template — not part of the headless app, just a demo of how it works. The agent runs as the signed-in user through the agent-chat Edge Function and calls your MCP server's tools, so it only touches the rows your RLS policies allow."
          />
          <div className="mt-6">
            <InstallCommand />
          </div>
        </>
      }
      panel={
        <MessageScrollerProvider autoScroll>
          <div className="flex h-[360px] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#171717] sm:h-[420px]">
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport>
                {hasMessages ? (
                  <MessageScrollerContent aria-busy={pending} className="gap-3 px-4 pt-4 pb-0">
                    {messages.map((entry) => {
                      if (entry.role === 'assistant' && !entry.content) return null

                      return (
                        <MessageAnimated
                          key={entry.id}
                          message={{
                            id: entry.id,
                            role: entry.role,
                            content: entry.content,
                          }}
                          scrollAnchor={entry.role === 'user'}
                        />
                      )
                    })}

                    {pending && !isStreaming ? (
                      <MessageScrollerItem>
                        <ShimmerMarker>Thinking…</ShimmerMarker>
                      </MessageScrollerItem>
                    ) : null}

                    {isStreaming ? (
                      <MessageScrollerItem>
                        <ShimmerMarker>Generating response…</ShimmerMarker>
                      </MessageScrollerItem>
                    ) : null}

                    {error ? (
                      <MessageScrollerItem>
                        <Marker>
                          <MarkerContent className="text-destructive" role="alert">
                            {error}
                          </MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                ) : (
                  <div className="grid h-full place-items-center px-4 py-4 text-center">
                    <div className="grid justify-items-center gap-2">
                      <div
                        aria-hidden="true"
                        className="grid h-11 w-11 place-items-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-[#6b7079]"
                      >
                        <Bot className="h-6 w-6" strokeWidth={1.5} />
                      </div>
                      <p className="mt-1 text-sm font-medium text-[#d6dae0]">Ask the agent</p>
                      <p className="max-w-[18rem] text-sm leading-6 text-[#6b7079]">
                        Try “List my tasks” or “Create a task to ship the agent page.”
                      </p>
                    </div>
                  </div>
                )}
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>

            <div className="shrink-0 border-t border-white/[0.07] p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Message the agent…"
                  disabled={pending}
                  className={cn(
                    'max-h-28 min-h-[2.5rem] w-full resize-none rounded-lg border border-border bg-white/[0.04] px-2.5 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-white/[0.22] focus-visible:bg-white/[0.06] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => void send()}
                  disabled={pending || !message.trim()}
                  aria-label="Send message"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </MessageScrollerProvider>
      }
    />
  )
}

function InstallCommand() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex items-center justify-between gap-2.5 rounded-[13px] border border-border bg-white/[0.04] py-2 pr-2.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[14.5px] text-[#e5e7eb]">
        <span className="text-primary">$</span> {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        onClick={copy}
        className="flex-none rounded-lg border border-border bg-white/[0.06] px-2.5 py-1.5 text-[13px] text-[#c5c9d0] transition-colors hover:bg-white/[0.12] hover:text-white"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
