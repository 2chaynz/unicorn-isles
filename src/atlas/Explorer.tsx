import { useEffect, useMemo, useRef, useState } from 'react'
import { STARTUPS } from '../data/load'
import type { Startup } from '../data/types'
import { BY_ID } from '../world'
import { sigilUrl } from '../Logo'
import { Icon } from '../icons'
import { money } from '../Facts'
import { askCala, imageToDataUrl, searchLogos, searchMeaning, similarTo, type Atlas, type CalaAnswer, type Hit } from './data'
import { raisedOf } from './AtlasView'

// Logo cut from the sprite sheet; falls back to the startup's pixel sigil.
export function LogoTile({ atlas, id, size = 30 }: { atlas: Atlas | null; id: string; size?: number }) {
  const m = atlas?.sprite.mapping[id]
  const t = BY_ID.get(id)
  if (!m || !atlas) return <img className="logo-tile" src={sigilUrl(t?.startup?.name ?? id, t?.color ?? [90, 90, 90])} width={size} height={size} alt="" />
  const k = size / atlas.sprite.cell
  return (
    <span className="logo-tile sprite" style={{
      width: size, height: size,
      backgroundImage: `url(${atlas.sprite.url})`,
      backgroundSize: `${atlas.sprite.width * k}px ${atlas.sprite.height * k}px`,
      backgroundPosition: `-${m.x * k}px -${m.y * k}px`,
    }} />
  )
}

const pct = (s: number) => `${Math.round(s * 100)}`

export type SearchTab = 'words' | 'meaning' | 'logos'
export interface Results { label: string; hits: Hit[] }

const MEANING_EXAMPLES = ['batteries for electric boats', 'AI that reads medical scans', 'tools for game studios', 'carbon capture from air', 'payments for freelancers']
const LOGO_EXAMPLES = ['a green leaf', 'a red circle', 'a rocket', 'a bird', 'black and white letters', 'a heart']

// Three ways to search, as on a document explorer: by name, by meaning, by look.
export function SearchPanel({ atlas, current, onPick, onResults, tab, setTab }: {
  atlas: Atlas | null
  current: string
  onPick: (id: string) => void
  onResults: (r: Results | null) => void
  tab: SearchTab
  setTab: (t: SearchTab) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picture, setPicture] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const asked = useRef(0)

  const words = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q.length > 1 ? STARTUPS.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)).slice(0, 60) : []
  }, [query])

  async function run(kind: SearchTab, body: { q?: string; image?: string }, label: string) {
    const n = ++asked.current
    setBusy(true)
    setError('')
    try {
      const out = kind === 'meaning' ? await searchMeaning(body.q!) : await searchLogos(body)
      if (n !== asked.current) return
      setHits(out)
      onResults({ label, hits: out.slice(0, 40) })
      if (out[0]) onPick(out[0].id)
    } catch (e) {
      if (n === asked.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (n === asked.current) setBusy(false)
    }
  }

  const submit = (q = query) => {
    if (!q.trim()) return
    setQuery(q)
    if (tab === 'meaning') run('meaning', { q }, `“${q}”`)
    if (tab === 'logos') { setPicture(null); run('logos', { q }, `logos like “${q}”`) }
  }

  async function searchPicture(file: File | undefined) {
    if (!file) return
    try {
      const image = await imageToDataUrl(file)
      setPicture(image)
      setTab('logos')
      run('logos', { image }, 'logos like your picture')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const switchTab = (t: SearchTab) => { setTab(t); setHits(null); setError(''); onResults(null) }

  return (
    <div className="search-panel"
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); searchPicture(e.dataTransfer.files[0]) }}>
      <div className="tabs">
        {(['words', 'meaning', 'logos'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => switchTab(t)}>
            <Icon name={t === 'words' ? 'search' : t === 'meaning' ? 'spark' : 'gem'} size={11} /> {t === 'words' ? 'name' : t === 'meaning' ? 'meaning' : 'logo'}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="search-row">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'words' ? 'startup name or keyword…' : tab === 'meaning' ? 'describe a company in your words…' : 'describe a logo, or drop a picture…'} />
        {tab === 'logos' && (
          <>
            <button type="button" className="icon-btn" title="Search with a picture" onClick={() => fileRef.current?.click()}><Icon name="save" size={13} /></button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => searchPicture(e.target.files?.[0])} />
          </>
        )}
      </form>
      {drag && <div className="drop-zone">drop a picture to find logos that look like it</div>}
      {tab !== 'words' && !hits && !busy && (
        <>
          <p className="muted hint">{tab === 'meaning'
            ? 'Finds startups by what they do, even with none of your words. Runs locally (bge-small embeddings).'
            : 'Finds logos by how they look (CLIP). Type a description or drop any picture here.'}</p>
          <div className="chips">
            {(tab === 'meaning' ? MEANING_EXAMPLES : LOGO_EXAMPLES).map((q) => <button key={q} className="tag" onClick={() => submit(q)}>{q}</button>)}
          </div>
        </>
      )}
      {picture && tab === 'logos' && <div className="query-pic"><img src={picture} alt="" /><span className="muted">your picture</span></div>}
      {busy && <p className="muted pad"><span className="live-dot pulse" /> searching… {atlas ? '' : '(loading the atlas)'}</p>}
      {error && <p className="ask-error pad">{error}</p>}
      {tab === 'words' && (
        <HitList atlas={atlas} items={words.map((s) => ({ id: s.id, score: -1 }))} current={current} onPick={onPick} empty={query.trim().length > 1 ? 'no match. Try the meaning tab' : 'type at least 2 letters'} />
      )}
      {tab === 'meaning' && hits && !busy && <HitList atlas={atlas} items={hits.slice(0, 40)} current={current} onPick={onPick} />}
      {tab === 'logos' && hits && !busy && <LogoGrid atlas={atlas} items={hits.slice(0, 48)} current={current} onPick={onPick} />}
    </div>
  )
}

export function HitList({ atlas, items, current, onPick, empty = 'nothing found', raised }: { atlas: Atlas | null; items: Hit[]; current: string; onPick: (id: string) => void; empty?: string; raised?: boolean }) {
  if (!items.length) return <p className="muted pad">{empty}</p>
  const top = Math.max(...items.map((h) => h.score))
  return (
    <ul className="track-list hits">
      {items.map((h) => {
        const s = BY_ID.get(h.id)?.startup
        if (!s) return null
        return (
          <li key={h.id} className={h.id === current ? 'current' : ''} onClick={() => onPick(h.id)}>
            <LogoTile atlas={atlas} id={h.id} />
            <span className="pick">
              <span className="name">{s.name}</span>
              <span className="meta">
                {raised
                  ? `${s.country}${s.founded ? ` · ${s.founded}` : ''} · ${raisedOf(s) ? `raised ${money(raisedOf(s), 'EUR')}` : s.stage !== 'Unknown' ? s.stage : 'no rounds on record'}`
                  : `${atlas ? `${atlas.clusters[atlas.byId.get(h.id)?.cluster ?? 0]?.label} · ` : ''}${s.country}`}
              </span>
            </span>
            {h.score >= 0 && !h.name && <span className="score" title="similarity"><i style={{ width: `${(h.score / (top || 1)) * 100}%` }} />{pct(h.score)}</span>}
            {h.name && <span className="score name-hit">name</span>}
          </li>
        )
      })}
    </ul>
  )
}

export function LogoGrid({ atlas, items, current, onPick }: { atlas: Atlas | null; items: Hit[]; current: string; onPick: (id: string) => void }) {
  if (!items.length) return <p className="muted pad">nothing found</p>
  return (
    <div className="logo-grid">
      {items.map((h) => {
        const s = BY_ID.get(h.id)?.startup
        return s && (
          <button key={h.id} className={h.id === current ? 'current' : ''} title={`${s.name} · ${s.sector}${h.score >= 0 ? ` · ${pct(h.score)}% alike` : ''}`} onClick={() => onPick(h.id)}>
            <LogoTile atlas={atlas} id={h.id} size={44} />
          </button>
        )
      })}
    </div>
  )
}

// "Reading a market": one theme of the atlas summarised for an investor.
export function ClusterPanel({ atlas, index, current, onPick, onInvestor, onSpot }: { atlas: Atlas; index: number; current: string; onPick: (id: string) => void; onInvestor: (id: string) => void; onSpot: (ids: string[]) => void }) {
  const c = atlas.clusters[index]
  const members = useMemo(() => atlas.points.filter((p) => p.cluster === index).map((p) => BY_ID.get(p.id)?.startup).filter(Boolean) as Startup[], [atlas, index])
  const stats = useMemo(() => {
    const count = <T,>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1])
    const raised = members.map(raisedOf)
    const total = raised.reduce((a, b) => a + b, 0)
    const funded = raised.filter(Boolean).length
    const investors = count(members.flatMap((s) => s.investors.map((i) => `${i.id}|${i.name}`))).slice(0, 10)
    const years = members.map((s) => s.founded).filter(Boolean) as number[]
    const recent = years.filter((y) => y >= new Date().getFullYear() - 3).length
    return {
      total, funded,
      sectors: count(members.map((s) => s.sector)).slice(0, 4),
      countries: count(members.map((s) => s.country)).slice(0, 4),
      stages: count(members.map((s) => s.stage).filter((s) => s !== 'Unknown')),
      investors,
      recent,
      slush: members.filter((s) => s.slush).length,
      top: [...members].sort((a, b) => raisedOf(b) - raisedOf(a)).filter((s) => raisedOf(s) > 0).slice(0, 6),
      young: [...members].filter((s) => (s.founded ?? 0) >= new Date().getFullYear() - 3 && !raisedOf(s)).slice(0, 6),
    }
  }, [members])
  const bar = (rows: [string, number][]) => (
    <div className="mix">
      {rows.map(([k, v]) => (
        <div key={k} className="mix-row"><span>{k}</span><i style={{ width: `${(v / members.length) * 100}%` }} /><b>{v}</b></div>
      ))}
    </div>
  )
  return (
    <div className="cluster-panel">
      <div className="cluster-head" style={{ borderColor: `rgb(${c.color.join(',')})` }}>
        <div className="kicker">theme found by the atlas</div>
        <h3 style={{ color: `rgb(${c.color.map((v) => Math.min(255, v + 40)).join(',')})` }}>{c.label}</h3>
        <div className="chips tight">{c.terms.map((t) => <span key={t} className="tag mini">{t}</span>)}</div>
      </div>
      <div className="kpis">
        <div><b>{members.length}</b><span>startups</span></div>
        <div><b>{stats.total ? money(stats.total, 'EUR') : '–'}</b><span>known raised</span></div>
        <div><b>{stats.funded}</b><span>with funding</span></div>
        <div><b>{stats.recent}</b><span>founded ≤3y</span></div>
      </div>
      <CalaMarket key={index} label={c.label} terms={c.terms} onPick={onPick} onSpot={onSpot} />
      <div className="section-title">Islands it spans</div>
      {bar(stats.sectors)}
      <div className="section-title">Countries</div>
      {bar(stats.countries)}
      {stats.stages.length > 0 && <><div className="section-title">Stages</div>{bar(stats.stages as [string, number][])}</>}
      {stats.investors.length > 0 && (
        <>
          <div className="section-title">Most active investors here</div>
          <div className="chips">
            {stats.investors.map(([k, n]) => {
              const [id, name] = k.split('|')
              return <button key={id} className="tag" title="Light up this investor's portfolio" onClick={() => onInvestor(id)}>{name} <span className="muted">{n}</span></button>
            })}
          </div>
        </>
      )}
      {stats.top.length > 0 && (
        <>
          <div className="section-title">Raised the most</div>
          <HitList atlas={atlas} items={stats.top.map((s) => ({ id: s.id, score: -1 }))} current={current} onPick={onPick} />
        </>
      )}
      {stats.young.length > 0 && (
        <>
          <div className="section-title">Young and unfunded (early look)</div>
          <HitList atlas={atlas} items={stats.young.map((s) => ({ id: s.id, score: -1 }))} current={current} onPick={onPick} />
        </>
      )}
    </div>
  )
}

// Right panel, from Cala's graph seen through the atlas: who competes (closest in meaning),
// who funds companies like this one (investors of the 30 nearest), and look-alike logos.
export function Twins({ atlas, id, onPick, onMoreLogos, onInvestor }: { atlas: Atlas | null; id: string; onPick: (id: string) => void; onMoreLogos: (id: string) => void; onInvestor: (id: string) => void }) {
  const [state, setState] = useState<{ id: string; hits: Hit[] } | null>(null)
  useEffect(() => {
    let live = true
    similarTo(id).then((hits) => live && setState({ id, hits: hits.slice(0, 30) })).catch(() => live && setState({ id, hits: [] }))
    return () => { live = false }
  }, [id])
  const near = state?.id === id && state.hits.length ? state.hits : (atlas?.near.get(id) ?? [])
  const backers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number; companies: string[] }>()
    for (const h of near) {
      const s = BY_ID.get(h.id)?.startup
      for (const inv of s?.investors ?? []) {
        const e = m.get(inv.id) ?? { id: inv.id, name: inv.name, n: 0, companies: [] }
        e.n++
        e.companies.push(s!.name)
        m.set(inv.id, e)
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10)
  }, [near])
  if (!atlas) return null
  const looks = atlas.logoNear.get(id)?.slice(0, 8) ?? []
  const p = atlas.byId.get(id)
  return (
    <section className="block twins card-in" key={`twins-${id}`}>
      <div className="section-title">Competitors <span className="muted">closest in meaning{p && <> · theme <b className="theme-name">{atlas.clusters[p.cluster].label}</b></>}</span></div>
      <HitList atlas={atlas} items={near.slice(0, 6)} current={id} onPick={onPick} raised />
      {backers.length > 0 && (
        <>
          <div className="section-title">Who funds companies like this <span className="muted">Cala investors of the {near.length} nearest</span></div>
          <div className="chips">
            {backers.map((b) => (
              <button key={b.id} className="tag" title={`Backed ${b.companies.slice(0, 6).join(', ')}. Click to light up their portfolio`} onClick={() => onInvestor(b.id)}>
                {b.name} <span className="muted">×{b.n}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {looks.length > 0 && (
        <>
          <div className="section-title">Look-alike logos <button className="link-btn" onClick={() => onMoreLogos(id)}>more</button></div>
          <LogoGrid atlas={atlas} items={looks.map((x) => ({ id: x, score: -1 }))} current={id} onPick={onPick} />
        </>
      )}
    </section>
  )
}

// Cala answers in markdown; the panel shows plain prose.
const plain = (md: string) => md.split('\n').filter((l) => !/^\s*(#|---)/.test(l)).join('\n')
  .replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim()
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]

// Live research on a theme from Cala's knowledge graph: recent rounds, amounts, investors, with sources.
function CalaMarket({ label, terms, onPick, onSpot }: { label: string; terms: string[]; onPick: (id: string) => void; onSpot: (ids: string[]) => void }) {
  const question = `Which Nordic and Baltic startups in ${terms.slice(0, 3).join(', ')} raised funding in the last 12 months? Give amounts, dates and lead investors.`
  const [state, setState] = useState<{ q: string; a: CalaAnswer | 'pending' } | null>(null)
  const [open, setOpen] = useState(false)
  const a = state?.q === question ? state.a : null
  const run = () => {
    setState({ q: question, a: 'pending' })
    askCala(question).then((out) => {
      setState({ q: question, a: out })
      const ids = (out.entities ?? []).map((e) => e.id).filter((x) => BY_ID.has(x))
      if (ids.length) onSpot(ids)
    })
  }
  return (
    <div className="cala-live market">
      <div className="ask-label"><span className={`live-dot ${a === 'pending' ? 'pulse' : a?.error ? 'off' : ''}`} /> Cala knowledge graph, live</div>
      {!a && (
        <button className="cala-btn" onClick={run} title={question}><Icon name="spark" size={11} /> Ask Cala who raised in {label} lately</button>
      )}
      {a === 'pending' && <p className="muted">Cala is researching “{label}”, this can take up to a minute…</p>}
      {a && a !== 'pending' && (a.error
        ? <p className="muted">Live answer unavailable ({a.error}) <button className="link-btn" onClick={run}>retry</button></p>
        : (
          <>
            <p className={`ask-answer ${open ? '' : 'clamped'}`} onClick={() => setOpen(!open)}>{plain(a.answer ?? '')}</p>
            {(a.entities ?? []).some((e) => BY_ID.has(e.id)) && (
              <div className="chips">{a.entities!.filter((e) => BY_ID.has(e.id)).map((e) => <button key={e.id} className="tag" onClick={() => onPick(e.id)}>{e.name}</button>)}</div>
            )}
            {(a.sources ?? []).length > 0 && <p className="ask-note">sources {a.sources!.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.name}>{host(s.url)}</a>)}</p>}
          </>
        ))}
    </div>
  )
}
