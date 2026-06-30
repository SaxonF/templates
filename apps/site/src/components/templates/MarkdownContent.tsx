import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

interface MarkdownContentProps {
  content: string
  className?: string
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        'prose prose-invert max-w-none text-[15px] leading-[1.55] text-[#c5c9d0]',
        '[&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-medium [&_h1]:text-white',
        '[&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-white',
        '[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-white',
        '[&_p]:mb-4 [&_p]:text-[#9aa0a8]',
        '[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline',
        '[&_strong]:font-medium [&_strong]:text-[#e5e7eb]',
        '[&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13.5px] [&_code]:text-[#e5e7eb]',
        '[&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-[13px] [&_pre]:border [&_pre]:border-border [&_pre]:bg-[#171717] [&_pre]:p-4',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13.5px]',
        '[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-[#9aa0a8]',
        '[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:text-[#9aa0a8]',
        '[&_li]:text-[#9aa0a8]',
        '[&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[14px]',
        '[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-[#e5e7eb]',
        '[&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:text-[#9aa0a8]',
        '[&_hr]:my-8 [&_hr]:border-border',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
