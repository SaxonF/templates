import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AuthGate } from '@/components/layout/AuthGate'
import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { getClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface OAuthGrant {
  client?: { id?: string; name?: string }
  client_id?: string
  client_name?: string
  scopes?: string[]
}

export function ClientsPage() {
  return (
    <AuthGate activePage="clients">
      {(user) => (
        <PageShell user={user} variant="account" activePage="clients">
          <ClientsContent />
        </PageShell>
      )}
    </AuthGate>
  )
}

function ClientsContent() {
  const [grants, setGrants] = useState<OAuthGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  async function loadGrants() {
    setLoading(true)
    setStatus(null)
    const oauth = getClient().auth.oauth as {
      listGrants: () => Promise<{ data?: OAuthGrant[] | null; error?: { message: string } | null }>
    }
    const { data, error } = await oauth.listGrants()

    if (error) {
      setStatus(error.message)
      setLoading(false)
      return
    }

    setGrants(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadGrants()
  }, [])

  async function revokeGrant(grant: OAuthGrant) {
    const clientId = grant.client?.id ?? grant.client_id
    if (!clientId) return

    const oauth = getClient().auth.oauth as {
      revokeGrant: (input: { clientId: string }) => Promise<{ error?: { message: string } | null }>
    }
    const { error } = await oauth.revokeGrant({ clientId })
    if (error) {
      setStatus(error.message)
      return
    }

    setStatus('Access revoked.')
    await loadGrants()
  }

  return (
    <PageLayout
      intro={
        <PageIntro
          title="Authorized clients"
          lead="The template includes a page where users can see which MCP clients have been authorized and revoke OAuth grants — useful when clients re-register on each sign-in."
        />
      }
      panel={
        <div>
          {loading ? <p className="text-muted-foreground">Loading clients…</p> : null}

          {!loading && grants.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-[13px] border border-border bg-white/[0.04] px-5 py-8 text-center">
              <div
                aria-hidden="true"
                className="grid h-11 w-11 place-items-center rounded-[10px] border border-border bg-white/[0.04] text-muted-foreground"
              >
                <Link2 className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <p className="mt-1 font-medium text-foreground">No clients authorized</p>
              <p className="max-w-[16rem] leading-6 text-muted-foreground">
                Connect an MCP client to see it listed here.
              </p>
            </div>
          ) : null}

          {!loading && grants.length > 0 ? (
            <div className="grid">
              {grants.map((grant) => {
                const clientId = grant.client?.id ?? grant.client_id ?? 'unknown-client'
                const name = grant.client?.name ?? grant.client_name ?? clientId
                return (
                  <div
                    key={clientId}
                    className="flex items-center justify-between gap-4 border-t border-border py-3 last:border-b"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Scopes: {(grant.scopes ?? []).join(', ') || 'none'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => revokeGrant(grant)}
                    >
                      Revoke
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}

          {status ? (
            <p
              className={cn('mt-4', status === 'Access revoked.' ? 'text-muted-foreground' : 'text-destructive')}
              role="status"
            >
              {status}
            </p>
          ) : null}
        </div>
      }
    />
  )
}
