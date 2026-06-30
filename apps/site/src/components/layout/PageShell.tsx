import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

import {
  SiteNav,
  type ActivePage,
  type LandingPage,
  type SiteNavVariant,
} from '@/components/layout/SiteNav'
import { cn } from '@/lib/utils'

interface PageShellProps {
  children: ReactNode
  user?: User | null
  variant?: SiteNavVariant
  activePage?: ActivePage
  landingPage?: LandingPage
  landingAlign?: 'center' | 'top'
  className?: string
}

export function PageShell({
  children,
  user,
  variant = 'account',
  activePage,
  landingPage,
  landingAlign = 'center',
  className,
}: PageShellProps) {
  if (variant === 'landing') {
    return (
      <div className={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
        <SiteNav variant="landing" landingPage={landingPage} />
        <main
          className={cn(
            'mx-auto flex w-full max-w-[1440px] flex-1 px-5 pt-6 pb-[70px] sm:px-11',
            landingAlign === 'top' ? 'items-start' : 'items-center'
          )}
        >
          {children}
        </main>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
      <SiteNav user={user} variant={variant} activePage={activePage} />
      <main className="flex w-full flex-1 items-center justify-center">{children}</main>
    </div>
  )
}
