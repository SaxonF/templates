import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  label?: string
  className?: string
  onError?: (message: string) => void
}

export function CopyButton({ value, label = 'Copy', className, onError }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      onError?.('Unable to copy automatically. Select the text and copy it manually.')
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={copy}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-lg border border-border bg-white/[0.06] p-1.5 text-[#c5c9d0] transition-colors hover:bg-white/[0.12] hover:text-white',
        copied && 'text-primary',
        className
      )}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}
