import { useEffect, useState } from 'react'
import { supabase } from './auth'

// Per-browser persistence; storage can throw in private mode, so fall back to memory.
// With a signed-in user, the value also syncs to their Supabase row (`column`).
export function useStored<T>(key: string, initial: T, userId?: string, column?: string) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  const saveLocal = (v: T) => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* memory only */ }
  }
  const saveRemote = (v: T) => {
    if (supabase && userId && column) supabase.from('user_state').upsert({ user_id: userId, [column]: v, updated_at: new Date().toISOString() }).then()
  }

  // On sign-in the account wins; a first login uploads what this browser already has.
  useEffect(() => {
    if (!supabase || !userId || !column) return
    supabase.from('user_state').select(column).eq('user_id', userId).maybeSingle().then(({ data }) => {
      const remote = (data as Record<string, unknown> | null)?.[column] as T | null | undefined
      if (remote != null) {
        setValue(remote)
        saveLocal(remote)
      } else {
        saveRemote(value)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const set = (v: T) => {
    setValue(v)
    saveLocal(v)
    saveRemote(v)
  }
  return [value, set] as const
}
