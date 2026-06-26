import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'

interface CliBlockProps {
  value: string
  shell?: boolean
  className?: string
  onCopyError?: (message: string) => void
}

export function CliBlock({ value, shell = false, className, onCopyError }: CliBlockProps) {
  const rows = Math.max(2, value.split('\n').length)

  return (
    <div className={cn('mt-2', className)}>
      <div
        className={cn(
          'rounded-[13px] border border-border bg-white/[0.04] focus-within:border-white/[0.22] focus-within:bg-white/[0.06]',
          shell ? 'relative flex items-center gap-2.5 px-3 py-2' : 'relative px-3 py-2.5 pr-12'
        )}
      >
        {shell ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 font-mono text-[0.93rem] text-[#e5e7eb]">
            <span className="flex-none text-primary">$</span>
            <input
              readOnly
              spellCheck={false}
              value={value}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 font-inherit text-inherit outline-none"
            />
          </div>
        ) : (
          <textarea
            readOnly
            spellCheck={false}
            rows={rows}
            value={value}
            className="block min-h-[5.5rem] w-full resize-y border-0 bg-transparent font-mono text-[0.85rem] leading-6 text-[#e5e7eb] outline-none"
          />
        )}
        <CopyButton
          value={value}
          className={shell ? 'static' : 'absolute top-2 right-2'}
          onError={onCopyError}
        />
      </div>
    </div>
  )
}
