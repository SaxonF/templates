import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'

interface CmdRowProps {
  value: string
  display?: string
  shell?: boolean
  className?: string
  onCopyError?: (message: string) => void
}

function truncateCommand(text: string) {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine
}

export function CmdRow({ value, display, shell = false, className, onCopyError }: CmdRowProps) {
  const shown = display ?? (shell ? truncateCommand(value) : value)

  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-2.5 rounded-[13px] border border-border bg-white/[0.04] px-3 py-2',
        className
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[0.93rem] text-[#e5e7eb]">
        {shell ? (
          <>
            <span className="text-primary">$</span> {shown}
          </>
        ) : (
          shown
        )}
      </code>
      <CopyButton value={value} onError={onCopyError} />
    </div>
  )
}
