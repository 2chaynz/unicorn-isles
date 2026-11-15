import { useEffect, useMemo, useState } from 'react'
import { LogoImg } from './Logo'
import { MATURITY, VALUE_SRC, isUnicorn, money, type World } from './world'
import { askCala, getLight, getRounds, getStartup, host, moneyOf, plain, shortDate, similar, toEur, type CalaAnswer, type Full, type Hit, type Light, type Round } from './api'

const RANK: Record<string, string> = { FILING: 'registry', PRIMARY: 'company', PRESS: 'press', AGGREGATOR: 'database' }
const STAGE: Record<string, string> = { PRE_SEED: 'Pre-seed', SEED: 'Seed', SERIES_A: 'Series A', SERIES_B: 'Series B' }
const stageName = (s?: string | null) => (s ? STAGE[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '')

function Src({ s }: { s?: { name: string; url: string; date: string | null; rank: string | null } | null }) {
  if (!s) return null
  return <a className="src" href={s.url} target="_blank" rel="noreferrer" title={s.name}>{RANK[s.rank ?? ''] ?? s.name}{s.date ? ` · ${shortDate(s.date)}` : ''}</a>
}

// One startup: Cala facts with their sources, live rounds, competitors and who funds companies like it.
export function Detail({ world, i, onPick, onClose, beside, fav, onFav }: { world: World; i: number; onPick: (id: string) => void; onClose: () => void; beside?: boolean; fav: boolean; onFav: () => void }) {
  const id = world.id[i]
  const [full, setFull] = useState<{ id: string; s: Full } | null>(null)
  const [near, setNear] = useState<{ id: string; hits: Hit[]; light: Light[] } | null>(null)
  const [rounds, setRounds] = useState<{ id: string; r: Round[]; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    getStartup(id).then((s) => live && setFull({ id, s })).catch(() => {})
    similar(id).then(async (hits) => {
      const top = hits.slice(0, 30)
      const light = await getLight(top.map((h) => h.id))
      if (live) setNear({ id, hits: top, light })
    }).catch(() => {})
    getRounds(id).then((r) => live && setRounds({ id, r: r.rounds ?? [], error: r.error })).catch(() => {})
    return () => { live = false }
  }, [id])
  const s = full?.id === id ? full.s : null
  const n = near?.id === id ? near : null
  const r = rounds?.id === id ? rounds : null
  const backers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number; co: string[] }>()
    for (const c of n?.light ?? []) for (const inv of c.investors) {
      const e = m.get(inv.id) ?? { id: inv.id, name: inv.name, n: 0, co: [] }
      e.n++; e.co.push(c.name); m.set(inv.id, e)
    }
    return [...m.values()].filter((b) => b.n > 1 || m.size < 8).sort((a, b) => b.n - a.n).slice(0, 8)
  }, [n])
  const theme = world.themes[world.cluster[i]]
  const p = s?.prov ?? {}
  const facts: [string, React.ReactNode][] = s ? [
    ['Valuation', world.value[i] ? <>{world.valueSrc[i] === 3 ? '≈ ' : ''}{money(world.value[i])} <span className="src-note">{s.valuation?.src === 'cala' ? `Cala · ${s.valuation.text}` : s.valuation ? 'model estimate, not from Cala' : VALUE_SRC[3]}</span></> : null],
    ['Company', world.maturity[i] ? <>{MATURITY[world.maturity[i]]}{s.public ? ' · listed' : ''}{s.employees ? ` · ~${s.employees.toLocaleString()} people` : ''}</> : null],
    ['Raised', s.totalFunding ? <>{moneyOf(s.totalFunding.value, s.totalFunding.units)} <Src s={p.total_funding} /></> : null],
    ['Stage', s.fundingStage ? <>{stageName(s.fundingStage)} <Src s={p.funding_stage} /></> : null],
    ['Founded', s.founded ? <>{s.founded} <Src s={p.founding_date} /></> : null],
    ['Team', s.headcount ? <>{s.headcount} people</> : null],
    ['HQ', s.hq ? <>{s.hq.replace(/^[\s,]+/, '')} <Src s={p.headquarters_address} /></> : null],
    ['Founders', s.founders?.length ? s.founders.map((f) => f.name).join(', ') : null],
  ].filter(([, v]) => v) as [string, React.ReactNode][] : []

  return (
    <aside className={`v2-detail glass ${beside ? 'beside' : ''}`} key={id}>
      <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
      <div className="head">
        <LogoImg world={world} i={i} size={56} />
        <div>
          <h2>{world.name[i]}</h2>
          <p className="sub">{world.countries[world.country[i]]}{world.founded[i] ? ` · ${world.founded[i]}` : ''}{world.raised[i] ? ` · ${money(world.raised[i])}` : ''}</p>
          <span className="theme-tag" style={{ background: `rgb(${theme.color.join(',')})` }}>{theme.label}</span>
          {world.maturity[i] > 0 && <span className={`theme-tag maturity m${world.maturity[i]}`}>{isUnicorn(world, i) ? 'Unicorn' : MATURITY[world.maturity[i]]}</span>}
        </div>
      </div>
      {s?.summary?.summary
        ? <p className="about">{s.summary.summary}</p>
        : <p className="about">{s?.description ?? '…'}</p>}
      {s?.summary?.summary && s.description && <p className="cala-line"><b>Cala</b> {s.description}</p>}
      {facts.length > 0 && <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}

      {s && s.investors.length > 0 && (
        <section>
          <h3>Backed by</h3>
          <div className="chips">{[...new Map(s.investors.map((b) => [b.name.toLowerCase(), b])).values()].slice(0, 14).map((b) => <span key={b.id} className="chip">{b.name}</span>)}</div>
        </section>
      )}
      {r && r.r.length > 0 && (
        <section>
          <h3>Rounds <span className="live">{r.error ? 'from import' : 'Cala, live'}</span></h3>
          <ul className="rounds">
            {r.r.map((x) => (
              <li key={x.id}>
                <b>{x.label ?? x.name ?? 'Round'}</b>
                {x.amount ? <span className="amt">{moneyOf(x.amount, x.units)}</span> : null}
                <span className="muted">{shortDate(x.date)}</span>
                {(x.leads?.length ?? 0) > 0 && <div className="muted">led by {x.leads!.map((l) => l.name).join(', ')}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Closest competitors <span className="muted">by meaning</span></h3>
        {!n ? <p className="muted">Finding neighbours…</p> : (
          <ul className="list">
            {n.hits.slice(0, 6).map((h) => {
              const k = world.index.get(h.id)
              const l = n.light.find((x) => x.id === h.id)
              return k === undefined ? null : (
                <li key={h.id} onClick={() => onPick(h.id)}>
                  <LogoImg world={world} i={k} />
                  <span className="txt"><b>{world.name[k]}</b><small>{world.countries[world.country[k]]}{l?.totalFunding ? ` · raised ${money(toEur(l.totalFunding))}` : l?.stage ? ` · ${stageName(l.stage)}` : ''}</small></span>
                  <span className="score">{Math.round(h.score * 100)}%</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {backers.length > 0 && (
        <section>
          <h3>Who funds companies like this</h3>
          <div className="chips">{backers.map((b) => <span key={b.id} className="chip" title={b.co.slice(0, 6).join(', ')}>{b.name} <i>×{b.n}</i></span>)}</div>
        </section>
      )}
      <div className="actions">
        <button className={`save ${fav ? 'on' : ''}`} onClick={onFav} title="Save to your list (F)">{fav ? '★ Saved' : '☆ Save'}</button>
        {s?.website && <a href={`https://${s.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer">{host(`https://${s.website}`)} ↗</a>}
      </div>
    </aside>
  )
}

// Themes found by the atlas; one opens into a market read with live Cala research.
export function ThemeSheet({ world, focus, visible, onFocus, onPick, onClose }: { world: World; focus: number | null; visible: Uint8Array; onFocus: (t: number | null) => void; onPick: (i: number) => void; onClose: () => void }) {
  const stats = useMemo(() => world.themes.map((t) => {
    let n = 0, raised = 0, funded = 0, young = 0
    for (let i = 0; i < world.n; i++) {
      if (world.cluster[i] !== t.index || !visible[i]) continue
      n++; raised += world.raised[i]
      if (world.raised[i]) funded++
      if (world.founded[i] >= 2023) young++
    }
    return { n, raised, funded, young }
  }), [world, visible])
  const maxRaised = Math.max(...stats.map((s) => s.raised), 1)
  if (focus !== null) return <Market world={world} t={focus} visible={visible} onBack={() => onFocus(null)} onPick={onPick} onClose={onClose} />
  const order = world.themes.map((t) => t.index).sort((a, b) => stats[b].n - stats[a].n)
  return (
    <aside className="v2-sheet glass">
      <div className="sheet-head"><h3>Themes</h3><button className="close" onClick={onClose}>✕</button></div>
      <p className="muted">Found automatically from what companies do. Bars show money raised.</p>
      <ul className="themes">
        {order.map((k) => {
          const t = world.themes[k], s = stats[k]
          return (
            <li key={k} onClick={() => onFocus(k)}>
              <i style={{ background: `rgb(${t.color.join(',')})` }} />
              <span className="name">{t.label}</span>
              <span className="bar"><b style={{ width: `${(s.raised / maxRaised) * 100}%` }} /></span>
              <span className="num">{s.n.toLocaleString()}</span>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function Market({ world, t, visible, onBack, onPick, onClose }: { world: World; t: number; visible: Uint8Array; onBack: () => void; onPick: (i: number) => void; onClose: () => void }) {
  const theme = world.themes[t]
  const data = useMemo(() => {
    const members: number[] = []
    for (let i = 0; i < world.n; i++) if (world.cluster[i] === t && visible[i]) members.push(i)
    const count = (f: (i: number) => string) => [...members.reduce((m, i) => m.set(f(i), (m.get(f(i)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
    const years = new Map<number, number>()
    for (const i of members) if (world.founded[i] >= 2010) years.set(world.founded[i], (years.get(world.founded[i]) ?? 0) + 1)
    return {
      members,
      raised: members.reduce((a, i) => a + world.raised[i], 0),
      regions: count((i) => world.region[world.country[i]]).slice(0, 5),
      stages: count((i) => world.stages[world.stage[i]]).filter(([k]) => k !== 'Unknown'),
      years: Array.from({ length: 2026 - 2010 + 1 }, (_, k) => years.get(2010 + k) ?? 0),
      top: [...members].sort((a, b) => world.raised[b] - world.raised[a]).filter((i) => world.raised[i]).slice(0, 6),
      early: members.filter((i) => world.founded[i] >= 2023 && !world.raised[i]).slice(0, 6),
    }
  }, [world, t, visible])
  const maxYear = Math.max(...data.years, 1)
  const question = `Which startups in ${theme.terms.slice(0, 3).join(', ')} raised funding in the last 12 months? Give amounts, dates and lead investors.`
  const [cala, setCala] = useState<CalaAnswer | 'pending' | null>(null)
  const bars = (rows: [string, number][]) => (
    <div className="mix">{rows.map(([k, v]) => <div key={k}><span>{k}</span><i style={{ width: `${(v / data.members.length) * 100}%` }} /><b>{v.toLocaleString()}</b></div>)}</div>
  )
  return (
    <aside className="v2-sheet glass">
      <div className="sheet-head"><button className="back" onClick={onBack}>‹ Themes</button><button className="close" onClick={onClose}>✕</button></div>
      <h2 className="market-title"><i style={{ background: `rgb(${theme.color.join(',')})` }} />{theme.label}</h2>
      <div className="terms">{theme.terms.join(' · ')}</div>
      <div className="kpis">
        <div><b>{data.members.length.toLocaleString()}</b><span>startups</span></div>
        <div><b>{money(data.raised) || '—'}</b><span>raised</span></div>
        <div><b>{data.early.length ? data.members.filter((i) => world.founded[i] >= 2023).length : 0}</b><span>since 2023</span></div>
      </div>
      <h3>Founded per year</h3>
      <div className="spark">{data.years.map((v, k) => <i key={k} title={`${2010 + k}: ${v}`} style={{ height: `${(v / maxYear) * 100}%` }} />)}</div>
      <div className="spark-axis"><span>2010</span><span>2026</span></div>
      <h3>Where</h3>{bars(data.regions)}
      {data.stages.length > 0 && <><h3>Stage</h3>{bars(data.stages)}</>}
      <div className="answer cala">
        <div className="label"><span className={`dot ${cala === 'pending' ? 'pulse' : ''}`} /> Cala, live research</div>
        {!cala && <button className="primary" onClick={() => { setCala('pending'); askCala(question).then(setCala) }}>Who raised money here lately?</button>}
        {cala === 'pending' && <p className="muted">Researching, up to a minute…</p>}
        {cala && cala !== 'pending' && (cala.error ? <p className="muted">Unavailable: {cala.error}</p> : (
          <>
            <p className="clamp-long">{plain(cala.answer ?? '')}</p>
            {(cala.sources ?? []).length > 0 && <p className="sources">{cala.sources!.slice(0, 5).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{host(s.url)}</a>)}</p>}
          </>
        ))}
      </div>
      {data.top.length > 0 && <><h3>Raised the most</h3><Mini world={world} list={data.top} onPick={onPick} /></>}
      {data.early.length > 0 && <><h3>Early and unfunded</h3><Mini world={world} list={data.early} onPick={onPick} /></>}
    </aside>
  )
}

function Mini({ world, list, onPick }: { world: World; list: number[]; onPick: (i: number) => void }) {
  return (
    <ul className="list">
      {list.map((i) => (
        <li key={i} onClick={() => onPick(i)}>
          <LogoImg world={world} i={i} />
          <span className="txt"><b>{world.name[i]}</b><small>{world.countries[world.country[i]]}{world.founded[i] ? ` · ${world.founded[i]}` : ''}</small></span>
          {world.raised[i] > 0 && <span className="score">{money(world.raised[i])}</span>}
        </li>
      ))}
    </ul>
  )
}
