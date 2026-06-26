import { useEffect, useState } from 'react'

import { AuthGate } from '@/components/layout/AuthGate'
import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface AuthorizationDetails {
  authorization_id?: string
  redirect_url?: string
  redirect_uri?: string
  scope?: string
  client?: {
    id?: string
    name?: string
  }
}

export function ConsentPage() {
  return (
    <AuthGate>
      {(user) => (
        <PageShell user={user} variant="account">
          <ConsentContent />
        </PageShell>
      )}
    </AuthGate>
  )
}

function ConsentContent() {
  const [details, setDetails] = useState<AuthorizationDetails | null>(null)
  const [status, setStatus] = useState('Loading request…')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')

  useEffect(() => {
    async function loadDetails() {
      if (!authorizationId) {
        setError('Missing authorization_id.')
        setStatus('')
        return
      }

      const oauth = getClient().auth.oauth as {
        getAuthorizationDetails: (
          authorizationId: string
        ) => Promise<{ data?: AuthorizationDetails | null; error?: { message: string } | null }>
      }
      const { data, error: detailsError } = await oauth.getAuthorizationDetails(authorizationId)

      if (detailsError || !data) {
        setError(detailsError?.message ?? 'Invalid authorization request.')
        setStatus('')
        return
      }

      if (!('authorization_id' in data) && data.redirect_url) {
        window.location.replace(data.redirect_url)
        return
      }

      setDetails(data)
      setStatus('')
    }

    void loadDetails()
  }, [authorizationId])

  async function decide(approved: boolean) {
    if (!authorizationId) return

    setPending(true)
    setStatus(approved ? 'Approving…' : 'Denying…')

    const oauth = getClient().auth.oauth as {
      approveAuthorization: (
        id: string,
        options: { skipBrowserRedirect: boolean }
      ) => Promise<{ data?: { redirect_url?: string } | null; error?: { message: string } | null }>
      denyAuthorization: (
        id: string,
        options: { skipBrowserRedirect: boolean }
      ) => Promise<{ data?: { redirect_url?: string } | null; error?: { message: string } | null }>
    }
    const operation = approved
      ? oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
    const { data, error: decisionError } = await operation

    if (decisionError || !data?.redirect_url) {
      setError(decisionError?.message ?? 'Unable to complete authorization.')
      setStatus('')
      setPending(false)
      return
    }

    window.location.assign(data.redirect_url)
  }

  const scopes =
    details?.scope
      ?.split(' ')
      .map((scope) => scope.trim())
      .filter(Boolean) ?? []

  return (
    <PageLayout
      intro={
        <PageIntro
          title="Authorize access"
          lead="The template includes an OAuth consent screen for when MCP clients request access, scoped to database and Edge Function permissions under your existing policies."
        />
      }
      panel={
        <div>
          {details ? (
            <div className="overflow-hidden rounded-[13px] border border-border bg-white/[0.04]">
              <h2 className="border-b border-border px-4 pt-4 pb-3 text-lg font-medium">
                Authorize {details.client?.name || 'MCP client'}
              </h2>

              <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5">
                <span className="text-muted-foreground">Client</span>
                <span className="min-w-0 text-right">
                  {details.client?.name || details.client?.id || 'Unknown client'}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5">
                <span className="text-muted-foreground">Redirect</span>
                <code className="min-w-0 text-right break-all font-mono">
                  {details.redirect_uri || 'Not provided'}
                </code>
              </div>

              {scopes.length ? (
                <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5">
                  <span className="text-muted-foreground">Scopes</span>
                  <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
                    {scopes.map((scope) => (
                      <Badge key={scope}>{scope}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="border-b border-border px-4 py-3 text-foreground">
                <p>
                  This client can read permitted database rows and invoke project Edge Functions.
                  Existing database and function permissions still apply.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-4">
                <Button variant="secondary" disabled={pending} onClick={() => decide(false)}>
                  Deny
                </Button>
                <Button disabled={pending} onClick={() => decide(true)}>
                  Allow access
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {status ? (
            <p className={cn('mt-4', error ? 'text-destructive' : 'text-muted-foreground')} role="status">
              {status}
            </p>
          ) : null}
        </div>
      }
    />
  )
}
