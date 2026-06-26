import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageLayoutProps {
  intro: ReactNode
  panel: ReactNode
  className?: string
  align?: 'top' | 'center'
}

export function PageLayout({ intro, panel, className, align = 'center' }: PageLayoutProps) {
  return (
    <div
      className={cn(
        'mx-auto grid w-full max-w-[var(--page-layout-width)] grid-cols-1 gap-8 px-5 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,var(--page-panel-width))] lg:gap-x-[6.5rem] lg:gap-y-12',
        align === 'top' ? 'items-start pt-[8rem]' : 'items-center py-8',
        className
      )}
    >
      <section className="w-full max-w-lg">{intro}</section>
      <section className="w-full max-w-[var(--page-panel-width)]">{panel}</section>
    </div>
  )
}

export function PageIntro({
  title,
  lead,
  titleClassName,
}: {
  title: string
  lead: string
  titleClassName?: string
}) {
  return (
    <>
      <h1 className={cn('text-lg font-medium', titleClassName)}>{title}</h1>
      <p className="mt-1.5 leading-[1.55] text-muted-foreground">{lead}</p>
    </>
  )
}
