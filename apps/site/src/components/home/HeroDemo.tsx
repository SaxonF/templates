import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { motion } from 'motion/react'

import { cn } from '@/lib/utils'

type ActiveView = 'agent' | 'database'

const PEEK = 44
const BACK_SCALE = 0.96

interface ChatMessage {
  id: number
  role: 'user' | 'agent'
  kind: 'text' | 'rows' | 'result'
  text?: string
  rows?: Array<{ title: string; assignee: string; due: string; status: string }>
  latency?: string
}

const RAW_ROWS = [
  { id: 'a1f3c2', title: 'Migrate auth to RLS policies', status: 'open', assignee: 'dana', priority: 'high', due: 'Jun 26' },
  { id: 'b7d4e9', title: 'Ship send-email edge function', status: 'open', assignee: 'marco', priority: 'high', due: 'Jun 27' },
  { id: 'c0a8f1', title: 'Backfill tasks.priority index', status: 'open', assignee: 'wei', priority: 'high', due: 'Jun 28' },
  { id: 'd3b6a4', title: 'Add realtime channel for tasks', status: 'in_progress', assignee: 'dana', priority: 'med', due: 'Jun 30' },
  { id: 'e9c1d7', title: 'Write seed.sql fixtures', status: 'in_progress', assignee: 'lena', priority: 'med', due: 'Jul 01' },
  { id: 'f2e5b8', title: 'Document RPC contracts', status: 'done', assignee: 'wei', priority: 'low', due: 'Jun 22' },
  { id: '0a7c3e', title: 'Rotate service role key', status: 'blocked', assignee: 'marco', priority: 'high', due: 'Jun 24' },
  { id: '1b8d6f', title: 'Set up pgvector embeddings', status: 'open', assignee: 'lena', priority: 'low', due: 'Jul 03' },
]

const DB_ROWS = Array.from({ length: 3 }, () => RAW_ROWS).flat()

const stackTransition = {
  type: 'spring' as const,
  stiffness: 280,
  damping: 32,
  mass: 0.9,
}

function statusColor(status: string) {
  if (status === 'open') return 'bg-primary'
  if (status === 'in_progress') return 'bg-[#e0b341]'
  if (status === 'done') return 'bg-[#7d828b]'
  if (status === 'blocked') return 'bg-destructive'
  return 'bg-[#7d828b]'
}

function priorityColor(priority: string) {
  if (priority === 'high') return 'text-[#e5e7eb]'
  if (priority === 'med') return 'text-[#9aa0a8]'
  return 'text-[#6b7079]'
}

function HeroCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-[480px] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#171717] sm:h-[604px]',
        className
      )}
    >
      {children}
    </div>
  )
}

function AgentPanel({
  feed,
  typing,
  scrollRef,
}: {
  feed: ChatMessage[]
  typing: boolean
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[18px] pt-5 pb-1.5"
      >
        {feed.map((message) => (
          <div
            key={message.id}
            className={cn(
              'animate-fade-in flex',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {message.kind === 'text' && message.role === 'user' ? (
              <div className="max-w-[82%] rounded-[15px] rounded-br-[4px] bg-white/10 px-[15px] py-2.5 text-[15px] leading-[1.4] text-white">
                {message.text}
              </div>
            ) : null}

            {message.kind === 'text' && message.role === 'agent' ? (
              <div className="max-w-[84%] text-[14.5px] leading-[1.5] text-[#b4b9c1]">{message.text}</div>
            ) : null}

            {message.kind === 'rows' && message.rows ? (
              <div className="max-w-[94%] w-full overflow-hidden rounded-[11px] border border-white/[0.08] bg-white/[0.05]">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                  <div className="h-[13px] w-[13px] rounded-[3px] bg-primary opacity-90" />
                  <span className="text-[12.5px] font-semibold text-[#e9ebef]">tasks</span>
                  <span className="text-[11.5px] text-[#7d828b]">
                    {message.rows.length} {message.rows.length === 1 ? 'row' : 'rows'}
                  </span>
                </div>
                {message.rows.map((row) => (
                  <div
                    key={row.title}
                    className="grid grid-cols-[minmax(0,1fr)_62px_56px_60px] items-center gap-2 border-b border-white/[0.045] px-3 py-2 last:border-b-0"
                  >
                    <span className="truncate text-[12.5px] text-[#d6dae0]">{row.title}</span>
                    <span className="font-mono text-[11.5px] text-[#8a8f98]">{row.assignee}</span>
                    <span className="font-mono text-[11.5px] text-[#6b7079]">{row.due}</span>
                    <span className="flex items-center gap-1 text-[11px] text-[#9aa0a8]">
                      <span className={cn('h-[5px] w-[5px] rounded-full', statusColor(row.status))} />
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {message.kind === 'result' ? (
              <div className="inline-flex max-w-[94%] items-center gap-2.5 rounded-[11px] border border-white/[0.09] bg-white/[0.05] px-[15px] py-2.5">
                <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full bg-primary text-xs font-bold text-black">
                  ✓
                </span>
                <span className="text-sm text-[#e5e7eb]">{message.text}</span>
                {message.latency ? (
                  <span className="font-mono text-xs text-[#6b7079]">· {message.latency}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}

        {typing ? (
          <div className="animate-fade-in flex justify-start">
            <div className="flex items-center gap-1 rounded-[14px] bg-white/[0.06] px-[15px] py-3">
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-[#8a8f98]" />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-[#8a8f98] [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-[#8a8f98] [animation-delay:0.4s]" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-3.5 pt-3 pb-3.5">
        <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-2">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-white/[0.14] text-[17px] text-[#8a8f98]">
            +
          </span>
          <span className="flex-1 text-[15px] text-[#6b7079]">Ask Backplane to do anything…</span>
          <span className="text-[13px] text-[#8a8f98]">Fast ▾</span>
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-primary text-base font-bold text-black">
            ↑
          </span>
        </div>
      </div>
    </>
  )
}

function DatabasePanel({
  dbHi,
  dbScrollRef,
}: {
  dbHi: number
  dbScrollRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      <div className="flex items-center justify-between bg-[#171717] px-4 py-4">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-primary"
            aria-hidden="true"
          >
            <path d="M12 3v18" />
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
          </svg>
          <span className="text-sm font-semibold">tasks</span>
        </div>
        <span className="text-xs text-[#6b7079]">{DB_ROWS.length} rows</span>
      </div>

      <div className="grid grid-cols-[58px_minmax(0,1.5fr)_78px_70px_46px_62px] gap-2 border-y border-white/[0.07] bg-[#171717] px-4 py-2 font-mono text-[10.5px] tracking-wide text-[#5b6068] uppercase">
        <span>id</span>
        <span>title</span>
        <span>status</span>
        <span>assignee</span>
        <span>prio</span>
        <span>due</span>
      </div>

      <div ref={dbScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {DB_ROWS.map((row, index) => (
          <div
            key={`${row.id}-${index}`}
            className={cn(
              'grid grid-cols-[58px_minmax(0,1.5fr)_78px_70px_46px_62px] items-center gap-2 border-b border-white/[0.04] px-4 py-2 transition-colors duration-500',
              index === dbHi && 'bg-white/[0.05]'
            )}
          >
            <span className="font-mono text-xs text-[#6b7079]">{row.id}</span>
            <span className="truncate text-[13px] text-[#d6dae0]">{row.title}</span>
            <span className="flex items-center gap-1.5 text-xs text-[#9aa0a8]">
              <span className={cn('h-1.5 w-1.5 rounded-full', statusColor(row.status))} />
              {row.status.replace('_', ' ')}
            </span>
            <span className="font-mono text-xs text-[#8a8f98]">{row.assignee}</span>
            <span className={cn('text-xs', priorityColor(row.priority))}>{row.priority}</span>
            <span className="font-mono text-xs text-[#6b7079]">{row.due}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export function HeroDemo() {
  const [activeView, setActiveView] = useState<ActiveView>('agent')
  const [feed, setFeed] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState(false)
  const [dbHi, setDbHi] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dbScrollRef = useRef<HTMLDivElement>(null)

  const agentFocused = activeView === 'agent'

  useEffect(() => {
    const interval = window.setInterval(() => setDbHi((value) => (value + 1) % DB_ROWS.length), 1300)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feed, typing])

  useEffect(() => {
    if (activeView !== 'database') return
    const dbEl = dbScrollRef.current
    const row = dbEl?.children[dbHi] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [dbHi, activeView])

  useEffect(() => {
    const tasks3 = [
      { title: 'Migrate auth to RLS policies', assignee: 'dana', due: 'Jun 26', status: 'open' },
      { title: 'Add realtime channel for tasks', assignee: 'marco', due: 'Jun 27', status: 'open' },
      { title: 'Set up pgvector embeddings', assignee: 'wei', due: 'Jun 28', status: 'open' },
    ]
    const newTask = [{ title: 'Rotate API keys', assignee: 'marco', due: 'Jun 27', status: 'open' }]
    const script: Array<
      | { typing: number }
      | { pause: number; reset?: boolean }
      | Omit<ChatMessage, 'id'>
    > = [
      { role: 'user', kind: 'text', text: 'Show high-priority tasks that are still open' },
      { typing: 900 },
      { role: 'agent', kind: 'text', text: 'You have 3 open high-priority tasks right now.' },
      { role: 'agent', kind: 'rows', rows: tasks3 },
      { pause: 1700 },
      { role: 'user', kind: 'text', text: 'Email each assignee a reminder' },
      { typing: 1000 },
      { role: 'agent', kind: 'result', text: 'Reminders sent to all 3 assignees', latency: '142ms' },
      { pause: 1700 },
      { role: 'user', kind: 'text', text: 'Mark the RLS migration as done' },
      { typing: 850 },
      { role: 'agent', kind: 'result', text: 'Updated “Migrate auth to RLS policies” → done' },
      { pause: 1700 },
      { role: 'user', kind: 'text', text: 'Add “Rotate API keys”, assign marco, due Friday' },
      { typing: 1000 },
      { role: 'agent', kind: 'text', text: 'Created it and assigned marco.' },
      { role: 'agent', kind: 'rows', rows: newTask },
      { pause: 1700 },
      { role: 'user', kind: 'text', text: 'How many people connected over MCP today?' },
      { typing: 900 },
      { role: 'agent', kind: 'result', text: '18 MCP sessions today · 4 new consents approved' },
      { pause: 2900, reset: true },
    ]

    const timers: number[] = []
    let index = 0
    let messageId = 0

    const later = (fn: () => void, ms: number) => {
      const timer = window.setTimeout(fn, ms)
      timers.push(timer)
    }

    const tick = () => {
      if (index >= script.length) return
      const event = script[index++]

      if ('typing' in event) {
        setTyping(true)
        later(tick, event.typing)
        return
      }

      if ('pause' in event) {
        if (event.reset) {
          later(() => {
            setFeed([])
            setTyping(false)
            index = 0
            later(tick, 650)
          }, event.pause)
        } else {
          later(tick, event.pause)
        }
        return
      }

      setFeed((current) => [...current, { ...event, id: messageId++ }])
      setTyping(false)
      later(tick, 780)
    }

    later(tick, 700)
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  return (
    <div className="w-full">
      <div className="mb-3.5 flex items-center justify-center gap-px">
        {(['agent', 'database'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setActiveView(view)}
            className={cn(
              'w-28 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
              activeView === view ? 'bg-white/[0.08] text-white' : 'bg-transparent text-muted-foreground'
            )}
          >
            {view === 'agent' ? 'Agent' : 'Database'}
          </button>
        ))}
      </div>

      <div className="relative h-[calc(480px+44px)] w-full overflow-visible sm:h-[calc(604px+44px)]">
        <motion.div
          className="absolute inset-x-0 top-0 origin-top will-change-transform"
          initial={false}
          animate={{
            y: agentFocused ? PEEK : 0,
            scale: agentFocused ? BACK_SCALE : 1,
            opacity: agentFocused ? 0.78 : 1,
            zIndex: agentFocused ? 10 : 30,
          }}
          transition={stackTransition}
        >
          <HeroCard className="shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <DatabasePanel dbHi={dbHi} dbScrollRef={dbScrollRef} />
          </HeroCard>
        </motion.div>

        <motion.div
          className="absolute inset-x-0 top-0 origin-top will-change-transform"
          initial={false}
          animate={{
            y: agentFocused ? 0 : PEEK,
            scale: agentFocused ? 1 : BACK_SCALE,
            opacity: agentFocused ? 1 : 0.78,
            zIndex: agentFocused ? 30 : 10,
          }}
          transition={stackTransition}
        >
          <HeroCard className="shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
            <AgentPanel feed={feed} typing={typing} scrollRef={scrollRef} />
          </HeroCard>
        </motion.div>
      </div>
    </div>
  )
}
