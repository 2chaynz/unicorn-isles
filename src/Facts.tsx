import { useEffect, useMemo, useState } from 'react'
import type { Ref, Source, Startup } from './data/types'
import { BY_ID, TILES } from './world'

const RANK_LABEL: Record<string, string> = { FILING: 'registry', PRIMARY: 'company', PRESS: 'press', AGGREGATOR: 'database' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }

export const shortDate = (d: string | null | undefined) => {
  const m = d?.match(/^(\d{4})-(\d{2})/)
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : d?.slice(0, 4) ?? ''
}

export function money(value: number | null | undefined, units?: string | null) {
  if (value == null) return null
  const sym = SYMBOL[units ?? ''] ?? ''
  const tail = sym ? '' : ` ${units ?? ''}`
  const n = value >= 1e9 ? `${+(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value)
  return `${sym}${n}${tail}`.trim()
}

// Where a fact comes from: source type and date, linking to the document.
export function Src({ s }: { s?: Source | null }) {
  if (!s) return null
  return (
    <a className="src" href={s.url} target="_blank" rel="noreferrer" title={`${s.name}${s.date ? `, ${s.date}` : ''}`}>
      {RANK_LABEL[s.rank ?? ''] ?? s.name}{s.date ? ` · ${shortDate(s.date)}` : ''}
    </a>
  )
}

interface Round {
  id: string; name?: string; label?: string | null; amount?: number | null; units?: string | null; date?: string | null
  leads?: Ref[]; others?: Ref[]; source?: Source | null; error?: string
}

// Rounds read live from Cala's entity graph: amount, date, lead investors, other participants.
export function LiveRounds({ startup, onInvestor }: { startup: Startup; onInvestor: (id: string) => void }) {
  const [state, setState] = useState<{ id: string; rounds?: Round[]; error?: string } | null>(null)

  useEffect(() => {
    if (!startup.rounds.length) return
    let live = true
    fetch('/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: startup.id }) })
      .then(async (r) => (r.ok ? r.json() : { error: `server ${r.status}` }))
      .then((b) => live && setState({ id: startup.id, rounds: b.rounds, error: b.error }))
      .catch((e) => live && setState({ id: startup.id, error: String(e) }))
    return () => { live = false }
  }, [startup])

  if (!startup.rounds.length) return null
  const ready = state?.id === startup.id ? state : null
  const rounds: Round[] = ready?.rounds ?? [...startup.rounds].reverse()
  const failed = ready?.error ?? (ready?.rounds?.length && ready.rounds.every((r) => r.error) ? ready.rounds[0].error : undefined)
  return (
    <>
      <div className="section-title">Rounds <span className="live-tag"><span className={`live-dot ${ready ? '' : 'pulse'} ${failed ? 'off' : ''}`} /> {!ready ? 'reading Cala…' : failed ? 'from import' : 'Cala, live'}</span></div>
      <ul className="rounds">
        {rounds.map((r) => (
          <li key={r.id}>
            <div className="round-head">
              <b>{r.name ?? 'Funding round'}</b>
              {money(r.amount, r.units) && <span className="amount">{money(r.amount, r.units)}</span>}
              <span className="muted">{shortDate(r.date)}</span>
              <Src s={r.source} />
            </div>
            {(r.leads?.length || r.others?.length) ? (
              <div className="round-people">
                {r.leads?.map((p) => <button key={p.id} className="lead" title="Lead investor: light up its portfolio" onClick={() => onInvestor(p.id)}>★ {p.name}</button>)}
                {r.others?.slice(0, 6).map((p) => <button key={p.id} title="Light up its portfolio" onClick={() => onInvestor(p.id)}>{p.name}</button>)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {failed && <p className="muted pad">Amounts and leads load live from Cala; unavailable right now ({failed}).</p>}
    </>
  )
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const lastRound = (s: Startup) => s.rounds.reduce<string | null>((a, r) => (r.date && (!a || r.date > a) ? r.date : a), null)

// For founders: who funds companies like this one, and which look-alikes just raised.
// "Like this one" = the nearest startups on the map, which are placed by similarity.
export function FounderView({ startup, onInvestor, onPick }: { startup: Startup; onInvestor: (id: string) => void; onPick: (id: string) => void }) {
  const { investors, raised } = useMemo(() => {
    const here = BY_ID.get(startup.id)!
    const near = TILES.filter((t) => t.startup && t.startup.id !== startup.id && t.sector === here.sector)
      .sort((a, b) => dist(a, here) - dist(b, here)).slice(0, 30).map((t) => t.startup!)
    const count = new Map<string, { ref: Ref; n: number }>()
    for (const s of near) for (const i of s.investors) count.set(i.id, { ref: i, n: (count.get(i.id)?.n ?? 0) + 1 })
    const since = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10)
    return {
      investors: [...count.values()].sort((a, b) => b.n - a.n).slice(0, 8),
      raised: near.filter((s) => (lastRound(s) ?? '') >= since).sort((a, b) => (lastRound(b) ?? '').localeCompare(lastRound(a) ?? '')).slice(0, 5),
    }
  }, [startup])

  if (!investors.length && !raised.length) return null
  return (
    <section className="block founder card-in" key={`founder-${startup.id}`}>
      {investors.length > 0 && (
        <>
          <div className="section-title">Who funds companies like this</div>
          <div className="chips">
            {investors.map(({ ref, n }) => (
              <button key={ref.id} className="tag" title={`Backs ${n} of the 30 most similar startups: light up its portfolio`} onClick={() => onInvestor(ref.id)}>{ref.name} <span className="muted">{n}</span></button>
            ))}
          </div>
        </>
      )}
      {raised.length > 0 && (
        <>
          <div className="section-title">Look-alikes that just raised</div>
          <ul className="raised">
            {raised.map((s) => (
              <li key={s.id} onClick={() => onPick(s.id)}>
                <span className="name">{s.name}</span>
                <span className="muted">{s.rounds[s.rounds.length - 1]?.name ?? 'round'} · {shortDate(lastRound(s))}{s.investors[0] ? ` · ${s.investors.slice(0, 2).map((i) => i.name).join(', ')}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
