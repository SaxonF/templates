import { useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

import { PageShell } from '@/components/layout/PageShell'
import type { ActivePage } from '@/components/layout/SiteNav'
import { configError } from '@/lib/config'
import { getClient, redirectToAuth } from '@/lib/supabase'

interface AuthGateProps {
  children: (user: User) => ReactNode
  activePage?: ActivePage
}

export function AuthGate({ children, activePage }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(configError)

  useEffect(() => {
    if (configError) return

    getClient()
      .auth.getUser()
      .then(({ data, error: authError }) => {
        if (authError || !data.user) {
          redirectToAuth()
          return
        }

        setUser(data.user)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load user.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (error) {
    return (
      <PageShell variant="account" activePage={activePage}>
        <div className="mx-auto w-full max-w-[var(--page-layout-width)] px-5 pt-[8rem] pb-8">
          <p className="text-destructive" role="alert">
            {error}
          </p>
        </div>
      </PageShell>
    )
  }

  if (loading || !user) {
    return (
      <PageShell variant="account" activePage={activePage}>
        <div className="mx-auto w-full max-w-[var(--page-layout-width)] px-5 pt-[8rem] pb-8">
          <p className="text-muted-foreground">Loading account…</p>
        </div>
      </PageShell>
    )
  }

  return children(user)
}
