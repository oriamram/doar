import { createClient } from '@supabase/supabase-js'
import { isNative } from './platform'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // On the web, Google redirects back to this page with ?code=... and supabase-js
    // finishes sign-in itself. In the Android app the code arrives via a deep link
    // instead (see auth.ts).
    detectSessionInUrl: !isNative,
  },
})
