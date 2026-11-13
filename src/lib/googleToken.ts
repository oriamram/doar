import { supabase } from './supabase'

/**
 * Short-lived Google access tokens for the Gmail API.
 *
 * Google's long-lived refresh token is kept server-side by the `google-token` Edge
 * Function (it needs the OAuth client secret to use it). The app only ever holds a
 * one-hour access token, in memory.
 */

let cached: { token: string; expiresAt: number } | null = null

/** Raised when Google no longer accepts our refresh token; the user must sign in again. */
export class ReauthRequiredError extends Error {
  constructor() {
    super('הגישה ל־Google פגה. צריך להתחבר מחדש.')
  }
}

async function callTokenFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('google-token', { body })
  if (error) {
    const status = (error as { context?: Response }).context?.status
    if (status === 401) throw new ReauthRequiredError()
    throw error
  }
  return data as T
}

/** Called once right after Google sign-in, while Supabase still hands us Google's tokens. */
export async function rememberGoogleTokens(refreshToken: string | null | undefined, accessToken?: string | null) {
  if (accessToken) cached = { token: accessToken, expiresAt: Date.now() + 50 * 60_000 }
  if (refreshToken) await callTokenFunction({ action: 'store', refresh_token: refreshToken })
}

let inFlight: Promise<string> | null = null

export async function getGoogleAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  // Several Gmail requests may ask at once; fetch a single new token for all of them.
  inFlight ??= callTokenFunction<{ access_token: string; expires_in: number }>({ action: 'access' })
    .then(({ access_token, expires_in }) => {
      cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
      return access_token
    })
    .finally(() => (inFlight = null))
  return inFlight
}

export function clearGoogleAccessToken() {
  cached = null
}

/** The token we already hold, if it's still good; for requests that can't wait (page closing). */
export function peekGoogleAccessToken(): string | null {
  return cached && cached.expiresAt > Date.now() + 10_000 ? cached.token : null
}

/**
 * Ask the server to delete this account and everything it keeps for it (the Google key,
 * notification addresses, scheduled letters, label rules). Throws if the server refused
 * or couldn't be reached, so the caller can say so instead of half-finishing.
 */
export async function eraseServerAccount() {
  await callTokenFunction({ action: 'erase' })
  cached = null
}
