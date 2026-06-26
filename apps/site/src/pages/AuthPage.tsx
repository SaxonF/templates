import { FormEvent, useEffect, useMemo, useState } from 'react'

import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configError } from '@/lib/config'
import { getClient, safeReturnTo } from '@/lib/supabase'

type AuthMode = 'sign-in' | 'sign-up'

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(configError)
  const [pending, setPending] = useState(false)

  const params = new URLSearchParams(window.location.search)
  const returnTo = useMemo(() => safeReturnTo(params.get('returnTo')), [params])
  const defaultAfterAuth = params.get('mode') === 'account' ? '/clients/' : '/setup/'
  const afterAuth = returnTo ?? defaultAfterAuth

  useEffect(() => {
    if (configError) return

    getClient()
      .auth.getUser()
      .then(({ data, error }) => {
        if (!error && data.user) window.location.replace(afterAuth)
      })
  }, [afterAuth])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus(null)
    setPending(true)

    const supabase = getClient()
    const result =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: new URL(
                returnTo ? `/auth/?returnTo=${encodeURIComponent(returnTo)}` : defaultAfterAuth,
                window.location.origin
              ).toString(),
            },
          })

    if (result.error) {
      setStatus(result.error.message)
      setPending(false)
      return
    }

    if (mode === 'sign-up' && !result.data.session) {
      setStatus('Check your email to confirm your account, then return here.')
      setPending(false)
      return
    }

    window.location.assign(afterAuth)
  }

  return (
    <PageShell variant="minimal">
      <PageLayout
        align="center"
        intro={
          <PageIntro
            title="Try the demo"
            lead="This demo runs the full template. Sign in to try the included task app and see how agents access the database as an authenticated user."
          />
        }
        panel={
          <div>
            <h2 className="text-lg font-medium">
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </h2>
            <p className="mt-1 text-muted-foreground">
              {mode === 'sign-in'
                ? 'Enter your email and password to continue.'
                : 'Enter your email and password to get started.'}
            </p>

            <form className="mt-4 grid gap-2.5" onSubmit={submit}>
              <Label>
                Email
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Label>
              <Label>
                Password
                <Input
                  type="password"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Label>
              <Button type="submit" disabled={pending || Boolean(configError)} className="mt-1 w-fit">
                {pending
                  ? mode === 'sign-in'
                    ? 'Signing in…'
                    : 'Creating account…'
                  : mode === 'sign-in'
                    ? 'Sign in'
                    : 'Create account'}
              </Button>
            </form>

            <p className="mt-3.5 text-muted-foreground">
              {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
              <button
                className="underline underline-offset-[0.15em]"
                type="button"
                onClick={() => {
                  setStatus(null)
                  setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                }}
              >
                {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
              </button>
            </p>

            {status ? (
              <p
                className={`mt-4 ${status === configError ? 'text-destructive' : 'text-muted-foreground'}`}
                role="status"
                aria-live="polite"
              >
                {status}
              </p>
            ) : null}
          </div>
        }
      />
    </PageShell>
  )
}
