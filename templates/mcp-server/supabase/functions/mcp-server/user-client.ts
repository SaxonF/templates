import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

export function createUserClient(request: Request): SupabaseClient | null {
  const authorization = request.headers.get('Authorization')

  if (!authorization) {
    return null
  }

  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  })
}
