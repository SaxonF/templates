import { createClient } from '@supabase/supabase-js'

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, configError } from '@/lib/config'

let client: ReturnType<typeof createClient> | undefined

export function getClient() {
  if (configError) {
    throw new Error(configError)
  }

  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true },
  })

  return client
}

export async function getUser() {
  const supabase = getClient()
  const { data, error } = await supabase.auth.getUser()
  return error ? null : data.user
}

export function safeReturnTo(value: string | null) {
  if (!value) return null

  const target = new URL(value, window.location.origin)
  return target.origin === window.location.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : null
}

export function redirectToAuth() {
  const returnTo = `${window.location.pathname}${window.location.search}`
  window.location.replace(`/auth/?returnTo=${encodeURIComponent(returnTo)}`)
}

