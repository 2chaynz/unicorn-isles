import { useEffect, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Null until the Supabase project exists; the app then keeps state in localStorage only.
export const supabase = url && anonKey ? createClient(url, anonKey) : null

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

export async function sendMagicLink(email: string) {
  if (!supabase) return 'Login is not configured yet.'
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } })
  return error ? error.message : null
}

export const signOut = () => supabase?.auth.signOut()
