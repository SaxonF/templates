// Shared front-end helpers for the MCP authorization UI.
//
// This is the single place that knows how to construct a Supabase client and
// guard the auth-only pages, so customizing the client options, bumping the
// supabase-js version, or changing the sign-in redirect happens here once
// instead of in every page. Page-specific UI stays in each page's own script.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from '../config.js'

export { MCP_SERVER_DESCRIPTION, MCP_SERVER_NAME, MCP_SERVER_URL, SUPABASE_URL }

// A page is misconfigured if the publishable key is missing or still a
// placeholder. config.js ships with the well-known local key, which works as-is
// for `supabase start`; hosting requires replacing it (see config.js).
export const configError =
  !SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_')
    ? 'Set SUPABASE_PUBLISHABLE_KEY in public/config.js before using this page.'
    : null

let client

/** Memoized browser Supabase client. Throws if config.js is not filled in. */
export function getClient() {
  if (configError) throw new Error(configError)
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true },
  })
  return client
}

/** Set the shared status line. Pass isError to style it as a failure. */
export function setStatus(element, message, isError = false) {
  if (!element) return
  element.textContent = message
  element.classList.toggle('error', Boolean(isError))
}

/**
 * Resolve the signed-in user, or redirect to the sign-in page (preserving the
 * current location as returnTo) and resolve to null. Callers should bail when
 * this returns null, since a navigation is already in flight.
 */
export async function requireUser(supabase) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    const returnTo = `${location.pathname}${location.search}`
    location.replace(`/auth/?returnTo=${encodeURIComponent(returnTo)}`)
    return null
  }
  return data.user
}

/**
 * Wire up the shared account nav (email label, sign-out button) used by the
 * authenticated pages. Safe to call on pages that omit any of those elements.
 */
export function mountAccountNav(supabase, user) {
  const email = document.querySelector('#user-email')
  if (email) email.textContent = user.email ?? user.id

  const nav = document.querySelector('#auth-nav')
  if (nav) nav.hidden = false

  const signOutButton = document.querySelector('#sign-out-button')
  signOutButton?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut()
    if (error) setStatus(document.querySelector('#status'), error.message, true)
    else location.assign('/auth/')
  })
}
