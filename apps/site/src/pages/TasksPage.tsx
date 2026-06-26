import { ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AuthGate } from '@/components/layout/AuthGate'
import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { getClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  title: string
  status: string
  priority: string
  due_on: string | null
}

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  canceled: 5,
}

const TABLE_GRID =
  'grid grid-cols-[58px_minmax(0,1.5fr)_78px_46px_62px] gap-2'

function statusColor(status: string) {
  if (status === 'in_progress') return 'bg-[#e0b341]'
  if (status === 'blocked') return 'bg-destructive'
  if (status === 'todo' || status === 'backlog') return 'bg-primary'
  return 'bg-[#7d828b]'
}

function priorityColor(priority: string) {
  if (priority === 'high' || priority === 'urgent') return 'text-[#e5e7eb]'
  if (priority === 'medium') return 'text-[#9aa0a8]'
  return 'text-[#6b7079]'
}

function priorityLabel(priority: string) {
  if (priority === 'medium') return 'med'
  return priority
}

function shortenId(id: string) {
  return id.replace(/-/g, '').slice(0, 6)
}

function formatDue(due: string | null) {
  if (!due) return '—'
  const date = new Date(`${due}T00:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function TableIcon() {
  return (
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
  )
}

function TasksTable({
  tasks,
  loading,
  status,
}: {
  tasks: Task[]
  loading: boolean
  status: string | null
}) {
  return (
    <>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#171717] sm:h-[420px]">
        <div className="flex shrink-0 items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <TableIcon />
            <span className="text-sm font-semibold">tasks</span>
          </div>
          <span className="text-xs text-[#6b7079]">
            {loading ? '…' : `${tasks.length} ${tasks.length === 1 ? 'row' : 'rows'}`}
          </span>
        </div>

        <div
          className={cn(
            TABLE_GRID,
            'shrink-0 border-y border-white/[0.07] px-4 py-2 font-mono text-[10.5px] tracking-wide text-[#5b6068] uppercase'
          )}
        >
          <span>id</span>
          <span>title</span>
          <span>status</span>
          <span>prio</span>
          <span>due</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <p className="px-4 py-6 text-sm text-[#6b7079]">Loading tasks…</p>
          ) : null}

          {!loading && tasks.length === 0 && !status ? (
            <div className="grid justify-items-center gap-2 px-5 py-10 text-center">
              <div
                aria-hidden="true"
                className="grid h-11 w-11 place-items-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-[#6b7079]"
              >
                <ListChecks className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <p className="mt-1 text-sm font-medium text-[#d6dae0]">No tasks yet</p>
              <p className="max-w-[16rem] text-sm leading-6 text-[#6b7079]">
                Ask the agent to create a task, then refresh to see it appear here.
              </p>
            </div>
          ) : null}

          {!loading && tasks.length > 0
            ? tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    TABLE_GRID,
                    'items-center border-b border-white/[0.04] px-4 py-2 last:border-b-0'
                  )}
                >
                  <span className="font-mono text-xs text-[#6b7079]">{shortenId(task.id)}</span>
                  <span className="truncate text-[13px] text-[#d6dae0]">{task.title}</span>
                  <span className="flex items-center gap-1.5 text-xs text-[#9aa0a8]">
                    <span className={cn('h-1.5 w-1.5 rounded-full', statusColor(task.status))} />
                    {task.status.replaceAll('_', ' ')}
                  </span>
                  <span className={cn('text-xs capitalize', priorityColor(task.priority))}>
                    {priorityLabel(task.priority)}
                  </span>
                  <span className="font-mono text-xs text-[#6b7079]">{formatDue(task.due_on)}</span>
                </div>
              ))
            : null}
        </div>
      </div>

      {status ? (
        <p className="mt-3 text-sm text-destructive" role="status">
          {status}
        </p>
      ) : null}
    </>
  )
}

export function TasksPage() {
  return (
    <AuthGate activePage="tasks">
      {(user) => (
        <PageShell user={user} variant="account" activePage="tasks">
          <TasksContent />
        </PageShell>
      )}
    </AuthGate>
  )
}

function TasksContent() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    async function loadTasks() {
      setLoading(true)
      setStatus(null)

      const { data, error } = await getClient()
        .from('tasks')
        .select('id, title, status, priority, due_on')
        .order('created_at', { ascending: false })

      if (error) {
        setStatus(error.message)
        setLoading(false)
        return
      }

      const rows = (data ?? []) as unknown as Task[]
      rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
      setTasks(rows)
      setLoading(false)
    }

    void loadTasks()
  }, [])

  return (
    <PageLayout
      intro={
        <PageIntro
          title="Tasks"
          titleClassName="text-base"
          lead="This page reads the tasks table directly with the signed-in user's RLS — the exact rows your agent sees and edits through the MCP server. Use it to verify that what the agent reports matches what's actually in the database."
        />
      }
      panel={<TasksTable tasks={tasks} loading={loading} status={status} />}
    />
  )
}
