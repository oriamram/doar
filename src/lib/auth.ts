import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { forgetGoogleTokens, rememberGoogleTokens } from './googleToken'
import { isNative } from './platform'
import { supabase } from './supabase'

/** Read, archive, label and send mail (everything except permanent delete). */
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

/** Deep link Google sends the Android app back to (registered in AndroidManifest.xml). */
const NATIVE_REDIRECT = 'app.doar.mail://auth'

/**
 * Where Google sends the browser back to. It must match an entry in Supabase's
 * Redirect URLs exactly, or Supabase silently falls back to its Site URL:
 * the hosted site is listed as `https://…/**`, which needs the trailing slash;
 * the local dev server is listed without one.
 */
function webRedirect(): string {
  const { origin, hostname } = window.location
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  return isLocal ? origin : `${origin}/`
}

/** Why finishing sign-in after returning from Google failed, if it did. */
export async function signInReturnError(): Promise<string | null> {
  const { error } = await supabase.auth.initialize()
  return error ? error.message : null
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GMAIL_SCOPE,
      // Ask Google for a refresh token, so the app stays signed in.
      queryParams: { access_type: 'offline', prompt: 'consent' },
      redirectTo: isNative ? NATIVE_REDIRECT : webRedirect(),
      // Google blocks its sign-in page inside app WebViews, so on Android we open
      // the real browser ourselves instead of navigating the app.
      skipBrowserRedirect: isNative,
    },
  })
  if (error) throw error
  if (isNative && data.url) await Browser.open({ url: data.url })
}

export async function signOut() {
  await forgetGoogleTokens()
  await supabase.auth.signOut()
}

let storedRefreshToken: string | null = null

/** Call once at startup. */
export function initAuth() {
  supabase.auth.onAuthStateChange((_event, session) => {
    const refreshToken = session?.provider_refresh_token
    if (!refreshToken || refreshToken === storedRefreshToken) return
    storedRefreshToken = refreshToken
    const accessToken = session.provider_token
    // supabase-js warns against awaiting its own calls inside this callback; defer.
    setTimeout(() => {
      rememberGoogleTokens(refreshToken, accessToken).catch((error) =>
        console.error('Could not save Google refresh token', error),
      )
    }, 0)
  })

  if (isNative) {
    void CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_REDIRECT)) return
      void Browser.close()
      const code = new URL(url).searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('Sign-in failed', error)
      }
    })
  }
}

/** The current Supabase session: undefined while loading, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}
