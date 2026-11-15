export interface Hit { id: string; score: number; name?: boolean }
export interface Ref { id: string; name: string }
export interface Light { id: string; name: string; country: string | null; founded: number | null; totalFunding: { value: number; units: string } | null; stage: string | null; investors: Ref[] }
export interface Source { name: string; url: string; date: string | null; rank: string | null }
export interface Full {
  id: string; name: string; sector: string | null; country: string | null; founded: number | null; website: string | null
  description: string; hq: string | null; fundingStage: string | null; totalFunding: { value: number; units: string } | null
  headcount: string | null; status: string | null; slush?: boolean
  valuation?: { eur: number; text: string; src: 'cala' | 'gemma' } | null; employees?: number; public?: boolean
  rounds: { id: string; name?: string; date: string | null }[]; investors: Ref[]; founders: Ref[]; ceo?: Ref[]
  summary: { summary: string; sources: { title: string; uri: string }[]; grounded?: boolean } | null
  prov: Record<string, Source> | null
}
export interface Round {
  id: string; name?: string; label?: string | null; amount?: number | null; units?: string | null; date?: string | null
  leads?: Ref[]; others?: Ref[]; source?: Source | null; error?: string
}
export interface GemmaAnswer { answer: string; picks: { id: string; why: string }[]; model: string }
export interface CalaAnswer { answer?: string; sources?: { name: string; url: string }[]; entities?: { id: string; name: string }[]; error?: string }

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const out = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error(out.error ?? res.statusText)
  return out as T
}

export const searchMeaning = (q: string) => post<{ hits: Hit[] }>('/api/semantic', { q }).then((r) => r.hits)
export const similar = (id: string) => post<{ hits: Hit[] }>('/api/semantic', { id }).then((r) => r.hits)
export const searchLogos = (body: { q?: string; image?: string; id?: string }) => post<{ hits: Hit[] }>('/api/logos', body).then((r) => r.hits)
export const getStartup = (id: string) => post<Full>('/api/startup', { id })
export const getLight = (ids: string[]) => post<Light[]>('/api/startup', { ids })
export const getRounds = (id: string) => post<{ rounds?: Round[]; error?: string }>('/api/rounds', { id })
export const askGemma = (question: string) => post<GemmaAnswer>('/api/ask-gemma', { question })
export const askCala = (question: string) => post<CalaAnswer>('/api/cala', { question }).catch((e) => ({ error: String(e.message ?? e) }))

// Shrinks a dropped picture before upload: CLIP only looks at 224x224 anyway.
export function imageToDataUrl(file: Blob, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')) }
    img.src = url
  })
}

const RATES: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.17, SEK: 0.087, NOK: 0.085, DKK: 0.134, ISK: 0.0066, CHF: 1.05, PLN: 0.23, CZK: 0.04, KRW: 0.00066,
  JPY: 0.0061, CAD: 0.67, SGD: 0.69, INR: 0.011, TRY: 0.027, BRL: 0.17, AED: 0.25, BGN: 0.51, AUD: 0.6, CNY: 0.13, HKD: 0.12, ILS: 0.25,
}
export const toEur = (m: { value: number; units: string } | null | undefined) => (m?.value ? m.value * (RATES[m.units] ?? 0) : 0)
const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }
export function moneyOf(value: number | null | undefined, units?: string | null) {
  if (!value) return ''
  const sym = SYMBOL[units ?? ''] ?? ''
  const n = value >= 1e9 ? `${+(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value)
  return sym ? `${sym}${n}` : `${n} ${units ?? ''}`.trim()
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (d?: string | null) => {
  const m = d?.match(/^(\d{4})-(\d{2})/)
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : d?.slice(0, 4) ?? ''
}
// Cala answers in markdown; panels show plain prose.
export const plain = (md: string) => md.split('\n').filter((l) => !/^\s*(#|---)/.test(l)).join('\n')
  .replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim()
export const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
