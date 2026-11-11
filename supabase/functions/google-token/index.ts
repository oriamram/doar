// google-token: keeps the user's Google refresh token on the server and hands the
// app short-lived Gmail access tokens.
//
// Why a server at all: turning a refresh token into an access token needs the
// Google OAuth client secret, which must never ship inside the app.
//
// POST { action: "store", refresh_token }  save the refresh token (right after sign-in)
// POST { action: "access" }                get { access_token, expires_in }
// POST { action: "forget" }                delete the stored token (sign-out)
//
// Requires secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Edge Functions → Secrets).
// Deployed with verify_jwt off because it checks the caller's Supabase session itself.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) return JSON.parse(keys).default
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Who is calling? Must be a signed-in Doar user.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Not signed in' }, 401)
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401)
  const userId = userData.user.id

  let body: { action?: string; refresh_token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (body.action === 'store') {
    if (!body.refresh_token) return json({ error: 'refresh_token is required' }, 400)
    const { error } = await admin
      .from('google_tokens')
      .upsert({ user_id: userId, refresh_token: body.refresh_token, updated_at: new Date().toISOString() })
    if (error) return json({ error: 'Could not save token' }, 500)
    return json({ ok: true })
  }

  if (body.action === 'forget') {
    await admin.from('google_tokens').delete().eq('user_id', userId)
    return json({ ok: true })
  }

  if (body.action === 'access') {
    const { data: row } = await admin
      .from('google_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle()
    if (!row) return json({ error: 'reauth', message: 'No Google token stored' }, 401)

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: row.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    const token = await response.json()

    if (!response.ok) {
      // invalid_grant: the user revoked access or the token expired; they must sign in again.
      if (token.error === 'invalid_grant') {
        await admin.from('google_tokens').delete().eq('user_id', userId)
        return json({ error: 'reauth', message: 'Google access was revoked or expired' }, 401)
      }
      console.error('Google token refresh failed', token.error, token.error_description)
      return json({ error: 'Google token refresh failed', detail: token.error }, 502)
    }

    return json({ access_token: token.access_token, expires_in: token.expires_in })
  }

  return json({ error: 'Unknown action' }, 400)
})
