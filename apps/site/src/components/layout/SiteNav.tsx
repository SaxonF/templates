import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

import { BACKPLANE_REPOSITORY_URL } from '@/lib/config'
import { cn } from '@/lib/utils'
import { getClient } from '@/lib/supabase'

export type SiteNavVariant = 'landing' | 'minimal' | 'account'
export type ActivePage = 'agent' | 'clients' | 'setup' | 'tasks'
export type LandingPage = 'templates' | 'headless-app'

interface SiteNavProps {
  user?: User | null
  variant?: SiteNavVariant
  activePage?: ActivePage
  landingPage?: LandingPage
}

function BrandMark({ large = false }: { large?: boolean }) {
  if (large) {
    return (
      <span
        aria-hidden="true"
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md bg-primary"
      >
        <span className="h-[9px] w-[9px] rounded-[2px] bg-black/85" />
      </span>
    )
  }

  return <span aria-hidden="true" className="h-[0.9rem] w-[0.9rem] flex-none rounded-[0.2rem] bg-primary" />
}

function NavLink({
  href,
  children,
  current,
  className,
  target,
  rel,
}: {
  href: string
  children: ReactNode
  current?: boolean
  className?: string
  target?: string
  rel?: string
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'text-[15px] font-normal text-muted-foreground transition-colors hover:text-foreground',
        current && 'text-foreground',
        className
      )}
    >
      {children}
    </a>
  )
}

function NavTextButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-0 bg-transparent p-0 text-[15px] font-normal text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  )
}

export function SiteNav({ user, variant = 'account', activePage, landingPage = 'templates' }: SiteNavProps) {
  async function signOut() {
    await getClient().auth.signOut()
    window.location.assign('/auth/')
  }

  if (variant === 'landing') {
    return (
      <header className="w-full">
        <nav className="mx-auto flex w-full max-w-[1440px] items-center px-5 py-6 sm:px-11 sm:py-[26px]">
          <div className="flex items-center gap-7 sm:gap-11">
            <a href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
              <BrandMark large />
              <span className="text-lg">Backplane</span>
            </a>
            <div className="hidden items-center gap-7 lg:flex">
              <NavLink href="/" current={landingPage === 'templates'}>
                Templates
              </NavLink>
              <NavLink href="/headless-app/" current={landingPage === 'headless-app'}>
                Headless App
              </NavLink>
              <NavLink href={BACKPLANE_REPOSITORY_URL} target="_blank" rel="noreferrer">
                GitHub <span className="text-[13px]">↗</span>
              </NavLink>
            </div>
          </div>
        </nav>
      </header>
    )
  }

  return (
    <header className="fixed inset-x-0 top-0 z-10 border-b border-border bg-background">
      <nav
        aria-label={variant === 'minimal' ? 'Site' : 'Account'}
        className="flex items-center justify-between gap-4 px-5 py-3.5"
      >
        <a href="/" className="inline-flex items-center gap-2 font-medium">
          <BrandMark />
          <span>Backplane</span>
        </a>

        {variant === 'account' && user ? (
          <div className="flex min-w-0 items-center gap-[0.85rem]">
            <span className="hidden max-w-[220px] truncate text-[15px] font-normal text-muted-foreground sm:inline">
              {user.email ?? user.id}
            </span>
            <span
              aria-hidden="true"
              className="hidden text-[15px] font-normal text-muted-foreground sm:inline"
            >
              /
            </span>
            <div className="flex flex-wrap items-center gap-[0.85rem]">
              <NavLink href="/tasks/" current={activePage === 'tasks'}>
                Tasks
              </NavLink>
              <NavLink href="/clients/" current={activePage === 'clients'}>
                Clients
              </NavLink>
              <NavLink href="/agent/" current={activePage === 'agent'}>
                Agent
              </NavLink>
              <NavLink href="/setup/" current={activePage === 'setup'}>
                Connect MCP
              </NavLink>
              <NavTextButton onClick={signOut}>Sign out</NavTextButton>
            </div>
          </div>
        ) : null}
      </nav>
    </header>
  )
}
