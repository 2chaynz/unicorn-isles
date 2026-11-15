import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IS_MOCK, SECTORS, STAGES, STARTUPS, loadProvenance, loadSummaries, type Summary } from './data/load'
import type { Provenance } from './data/types'
import type { Startup } from './data/types'
import type { Tile } from './layout'
import { useStored } from './useStored'
import { sendMagicLink, signOut, supabase, useSession } from './auth'
import { useClock } from './anim'
import { Icon } from './icons'
import { Logo, sigilUrl } from './Logo'
import { MapView, type FlyRequest } from './MapView'
import { AskBox } from './AskBox'
import { FounderView, LiveRounds, Src, money } from './Facts'
import { BY_ID, ISLANDS, LAND, PARTNER, TILES } from './world'
import { useAtlas, searchLogos } from './atlas/data'
import { AtlasView, COLOR_BY, STAGE_LEGEND, type ColorBy } from './atlas/AtlasView'
import { ClusterPanel, LogoGrid, SearchPanel, Twins, type Results, type SearchTab } from './atlas/Explorer'
import './App.css'

const COUNTRIES = [...new Set(STARTUPS.map((s) => s.country))].sort()
const YEARS = [...new Set(STARTUPS.map((s) => s.founded).filter(Boolean) as number[])].sort()
// Stage comes from funding rounds; hide it until Cala details are imported.
const HAS_STAGES = STARTUPS.some((s) => s.stage !== 'Unknown')
const HAS_SLUSH = STARTUPS.some((s) => s.slush)
const SOFA_SECONDS = 6
const now = () => performance.now() / 1000

interface Filters { sector: string; stage: string; country: string; investor: string; year: string; funded: string; slush: string }
const NO_FILTERS: Filters = { sector: '', stage: '', country: '', investor: '', year: '', funded: '', slush: '' }
type Drawer = 'none' | 'search' | 'gems' | 'island' | 'cluster' | 'results'
// islands = the sector archipelago; meaning = t-SNE of what startups do; logos = t-SNE of how they look.
type MapMode = 'islands' | 'meaning' | 'logos'
const MODES: { key: MapMode; label: string; title: string }[] = [
  { key: 'islands', label: 'islands', title: 'One island per sector (1)' },
  { key: 'meaning', label: 'atlas', title: 'Every startup placed by what it does: t-SNE of text embeddings, themes found automatically (2)' },
  { key: 'logos', label: 'logo sea', title: 'Every logo placed by how it looks: t-SNE of CLIP image embeddings (3)' },
]

function matches(s: Startup, f: Filters) {
  return (!f.sector || s.sector === f.sector)
    && (!f.stage || s.stage === f.stage)
    && (!f.country || s.country === f.country)
    && (!f.investor || s.investors.some((i) => i.id === f.investor))
    && (!f.year || s.founded === +f.year)
    && (!f.funded || !!s.funding || !!s.totalFunding || s.rounds.length > 0)
    && (!f.slush || !!s.slush)
}

function readHash(): { x: number; y: number; id?: string } | null {
  const m = location.hash.match(/^#(-?\d+)~(-?\d+)(?:\/startup~([\w-]+))?/)
  return m ? { x: +m[1], y: +m[2], id: m[3] } : null
}

const dist = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y)

export default function App() {
  const initial = readHash()
  const startId = initial?.id && BY_ID.has(initial.id) ? initial.id : STARTUPS[0].id
  const start = BY_ID.get(startId)!
  const [fly, setFly] = useState<FlyRequest>({ x: start.x, y: start.y, zoom: 4.2, seq: 0 })
  const [selectedId, setSelectedId] = useState(startId)
  const [history, setHistory] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  // Startups picked by the last Gemini answer; empty = no spotlight.
  const [spotlight, setSpotlight] = useState<string[]>([])
  const [spotLabel, setSpotLabel] = useState('')
  // Similarity of each spotlit startup to the last search, for the atlas shading.
  const [scores, setScores] = useState<Map<string, number> | null>(null)
  const atlas = useAtlas()
  const [mode, setMode] = useState<MapMode>('islands')
  const [colorBy, setColorBy] = useState<ColorBy>('cluster')
  const [searchTab, setSearchTab] = useState<SearchTab>('meaning')
  const [cluster, setCluster] = useState<number | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [atlasFly, setAtlasFly] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>('none')
  const [openIsland, setOpenIsland] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const session = useSession()
  const uid = session?.user.id
  const [gems, setGems] = useStored<string[]>('gems', [], uid, 'gems')
  const [lists, setLists] = useStored<Record<string, string[]>>('lists', {}, uid, 'lists')
  const [discovered, setDiscovered] = useStored<string[]>('discovered', [], uid, 'discovered')
  const [savedFilters, setSavedFilters] = useStored<Filters[]>('savedFilters', [], uid, 'saved_filters')
  const [newIsland, setNewIsland] = useState<string | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [loginMsg, setLoginMsg] = useState('')
  const [sofa, setSofa] = useState(false)
  const [hideSeen, setHideSeen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [allInvestors, setAllInvestors] = useState(false)
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  useEffect(() => { loadSummaries().then(setSummaries) }, [])
  const [provenance, setProvenance] = useState<Provenance>({})
  useEffect(() => { loadProvenance().then(setProvenance) }, [])
  const [hopAt, setHopAt] = useState(now)

  const tile = BY_ID.get(selectedId)!
  const selected = tile.startup!
  const visible = useMemo(() => new Set(STARTUPS.filter((s) => matches(s, filters) && (!spotlight.length || spotlight.includes(s.id))).map((s) => s.id)), [filters, spotlight])
  const discoveredSet = useMemo(() => new Set(discovered), [discovered])
  const gemSet = useMemo(() => new Set(gems.filter((g) => BY_ID.has(g))), [gems])
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  const isGem = gemSet.has(selected.id)

  // Closest startups on the same island: the "album" around the current one.
  const neighbours = useMemo(() => TILES
    .filter((t) => t.startup && t.sector === tile.sector)
    .sort((a, b) => dist(a, tile) - dist(b, tile))
    .slice(0, 6)
    .map((t) => t.startup!), [tile])

  function flyTo(x: number, y: number, zoom?: number) {
    setFly((f) => ({ x, y, zoom, seq: f.seq + 1 }))
  }

  function select(id: string, fly = true) {
    const t = BY_ID.get(id)
    if (!t || id === selectedId) return
    setHistory((h) => [...h, selectedId].slice(-200))
    setSelectedId(id)
    setAddMenu(false)
    setAllInvestors(false)
    if (!discoveredSet.has(id)) setDiscovered([...discovered, id])
    if (fly) { flyTo(t.x, t.y); setAtlasFly((n) => n + 1) }
    setHopAt(now())
  }

  // Next = nearest unseen startup that passes the filters, preferring this island.
  function next() {
    const pool = TILES.filter((t) => t.startup && t.startup.id !== selectedId && visible.has(t.startup.id))
    const unseen = pool.filter((t) => !discoveredSet.has(t.startup!.id))
    const candidates = unseen.length ? unseen : pool
    const sameIsland = candidates.filter((t) => t.sector === tile.sector)
    const from = sameIsland.length ? sameIsland : candidates
    if (!from.length) return
    select(from.reduce((a, b) => (dist(a, tile) <= dist(b, tile) ? a : b)).startup!.id)
  }

  function shuffle() {
    const pool = STARTUPS.filter((s) => visible.has(s.id) && s.id !== selectedId)
    if (pool.length) select(pool[Math.floor(Math.random() * pool.length)].id)
  }

  function previous() {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setSelectedId(prev)
    const t = BY_ID.get(prev)!
    flyTo(t.x, t.y)
    setAtlasFly((n) => n + 1)
  }

  function spot(ids: string[], label: string, sc: Map<string, number> | null = null) {
    setSpotlight(ids)
    setSpotLabel(label)
    setScores(sc)
  }
  function clearSpot() { spot([], ''); setCluster(null); setResults(null) }
  function showResults(r: Results | null) {
    if (!r) return clearSpot()
    setCluster(null)
    spot(r.hits.map((h) => h.id), r.label, new Map(r.hits.map((h) => [h.id, h.score])))
  }
  function openCluster(i: number) {
    if (!atlas) return
    setCluster(i)
    setDrawer('cluster')
    if (mode === 'logos') setMode('meaning')
    spot(atlas.points.filter((p) => p.cluster === i).map((p) => p.id), `theme: ${atlas.clusters[i].label}`)
  }
  async function moreLogos(id: string) {
    try {
      const hits = (await searchLogos({ id })).slice(0, 40)
      const r = { label: `logos like ${BY_ID.get(id)?.startup?.name ?? 'this one'}`, hits: [{ id, score: 1 }, ...hits] }
      showResults(r)
      setResults(r)
      setMode('logos')
      setDrawer('results')
    } catch (e) {
      console.warn(e)
    }
  }

  const toggleSofa = () => { setHopAt(now()); setSofa((v) => !v) }
  const toggleGem = () => setGems(isGem ? gems.filter((g) => g !== selected.id) : [...gems.filter((g) => BY_ID.has(g)), selected.id])
  const toggleFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? '' : v }))

  useEffect(() => {
    window.history.replaceState(null, '', `#${tile.x}~${tile.y}/startup~${selectedId}`)
  }, [selectedId, tile])

  // Sofa mode: hop to the next startup every few seconds.
  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    if (!sofa) return
    const id = setInterval(() => nextRef.current(), SOFA_SECONDS * 1000)
    return () => clearInterval(id)
  }, [sofa, hopAt])

  // Stable handlers so the memoised map only re-renders when its data changes.
  const selectRef = useRef(select)
  selectRef.current = select
  const onPick = useCallback((id: string) => selectRef.current(id, false), [])
  const flyPick = useCallback((id: string) => selectRef.current(id), [])

  useEffect(() => {
    const island = ISLANDS.find((i) => i.sector === filters.sector)
    if (island) flyTo(island.cx, island.cy, 2.5)
  }, [filters.sector])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return
      const actions: Record<string, () => void> = {
        n: next, ArrowRight: next, p: previous, ArrowLeft: previous, s: shuffle, g: toggleGem,
        '/': () => setDrawer('search'),
        '1': () => setMode('islands'), '2': () => setMode('meaning'), '3': () => setMode('logos'),
        r: () => flyTo(tile.x, tile.y),
        ' ': toggleSofa,
        Escape: () => setDrawer('none'),
        c: () => setDrawer(drawer === 'search' ? 'none' : 'search'),
      }
      if (actions[e.key]) {
        e.preventDefault()
        actions[e.key]()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const islandMembers = openIsland ? (lists[openIsland] ?? []).map((id) => BY_ID.get(id)?.startup).filter(Boolean) as Startup[] : []
  const funded = !!selected.funding || !!selected.totalFunding || selected.rounds.length > 0

  const filterRows: { key: keyof Filters; label: string; options: string[] }[] = [
    { key: 'sector', label: 'sector', options: SECTORS },
    { key: 'country', label: 'country', options: COUNTRIES },
    { key: 'year', label: 'founded', options: YEARS.map(String) },
    ...(HAS_STAGES ? [{ key: 'stage' as const, label: 'stage', options: STAGES }] : []),
    { key: 'funded', label: 'funding', options: ['funded'] },
    ...(HAS_SLUSH ? [{ key: 'slush' as const, label: 'event', options: ['Slush 2026'] }] : []),
  ]

  // The current startup's own attributes; clicking one filters the map by it.
  const facts: { key: keyof Filters; value: string; text: string }[] = [
    { key: 'sector', value: selected.sector, text: selected.sector },
    { key: 'country', value: selected.country, text: selected.country },
    ...(selected.founded ? [{ key: 'year' as const, value: String(selected.founded), text: `est. ${selected.founded}` }] : []),
    ...(funded ? [{ key: 'funded' as const, value: 'funded', text: 'funded' }] : []),
    ...(selected.slush ? [{ key: 'slush' as const, value: 'Slush 2026', text: 'at Slush 2026' }] : []),
  ]
  const prov = provenance[selected.id]
  const partner = ISLANDS.find((i) => i.sector === PARTNER.get(selected.id))
  const copyLink = () => { navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <nav className="left">
        <section className="block nav-block">
          <div className="brand">
            <span className="logo">unicorn~isles</span>
            <button className="icon-btn" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '◂'}</button>
          </div>
          <button className={`nav-item ${drawer === 'search' ? 'on' : ''}`} onClick={() => setDrawer(drawer === 'search' ? 'none' : 'search')}><Icon name="search" /><span>Search</span></button>
          <button className={`nav-item ${drawer === 'gems' ? 'on' : ''}`} onClick={() => setDrawer(drawer === 'gems' ? 'none' : 'gems')}><Icon name="gem" /><span>Gems</span>{gemSet.size > 0 && <b className="badge">{gemSet.size}</b>}</button>
          <button className="nav-item" onClick={shuffle}><Icon name="compass" /><span>Surprise me</span></button>
          <button className={`nav-item ${mode === 'meaning' ? 'on' : ''}`} title={MODES[1].title} onClick={() => setMode(mode === 'meaning' ? 'islands' : 'meaning')}><Icon name="dots" /><span>Atlas</span></button>
          <button className={`nav-item ${mode === 'logos' ? 'on' : ''}`} title={MODES[2].title} onClick={() => setMode(mode === 'logos' ? 'islands' : 'logos')}><Icon name="flag" /><span>Logo sea</span></button>
        </section>

        {atlas && (
          <section className="block themes-block">
            <div className="block-head"><span>themes</span><span className="count-badge">{atlas.clusters.length}</span></div>
            {[...atlas.clusters].sort((a, b) => b.size - a.size).map((c) => (
              <button key={c.index} className={`nav-item sub ${cluster === c.index ? 'on' : ''}`} title={c.terms.join(', ')} onClick={() => (cluster === c.index ? clearSpot() : openCluster(c.index))}>
                <span className="dot" style={{ background: `rgb(${c.color.join(',')})` }} /><span>{c.label}</span><b className="count-badge">{c.size}</b>
              </button>
            ))}
          </section>
        )}

        <section className="block islands-block">
          <div className="block-head">
            <span>islands</span>
            <button className="icon-btn" title="Create island" onClick={() => setNewIsland('')}><Icon name="plus" size={12} /></button>
          </div>
          <button className={`nav-item ${!filters.sector ? 'on' : ''}`} onClick={() => setFilters((f) => ({ ...f, sector: '' }))}><Icon name="island" /><span>All islands</span></button>
          {newIsland !== null && (
            <form className="inline-form" onSubmit={(e) => {
              e.preventDefault()
              const name = newIsland.trim()
              if (name && !lists[name]) setLists({ ...lists, [name]: [] })
              setNewIsland(null)
            }}>
              <input autoFocus placeholder="island name, e.g. Nordic seed fintech" value={newIsland} onChange={(e) => setNewIsland(e.target.value)} onBlur={() => !newIsland && setNewIsland(null)} />
            </form>
          )}
          {Object.entries(lists).map(([name, ids]) => (
            <button key={name} className={`nav-item sub ${drawer === 'island' && openIsland === name ? 'on' : ''}`} onClick={() => { setOpenIsland(name); setDrawer('island') }}>
              <span className="dot" /><span>{name}</span><b className="count-badge">{ids.length}</b>
            </button>
          ))}
          {Object.keys(lists).length === 0 && newIsland === null && <p className="muted pad">no islands yet... collect startups into your own islands</p>}
        </section>

        <section className="block profile">
          <img className="avatar" src={sigilUrl(session?.user.email ?? 'guest', [110, 80, 150])} alt="" />
          <div className="profile-text">
            <div className="who">{session?.user.email?.split('@')[0] ?? 'guest sailor'}</div>
            <div className="muted"><Icon name="boat" size={10} /> {discovered.length} startups discovered</div>
          </div>
        </section>
        {loginOpen && !session && (
          <form className="block login" onSubmit={async (e) => {
            e.preventDefault()
            setLoginMsg('sending…')
            const err = await sendMagicLink(email)
            setLoginMsg(err ?? 'Check your inbox for the sign-in link.')
          }}>
            <input type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit">send sign-in link</button>
            {loginMsg && <p className="muted">{loginMsg}</p>}
          </form>
        )}
        <section className="block bottom-row">
          <button className="nav-item small" onClick={() => { setFilters(NO_FILTERS); setHideSeen(false) }}><Icon name="gear" size={12} /><span>Reset view</span></button>
          {supabase && (session
            ? <button className="nav-item small" onClick={() => signOut()}><Icon name="door" size={12} /><span>Sign out</span></button>
            : <button className="nav-item small" onClick={() => setLoginOpen(!loginOpen)}><Icon name="door" size={12} /><span>Sign in</span></button>)}
        </section>
      </nav>

      <main className="map">
        <div className="map-canvas">
          {mode === 'islands' || !atlas
            ? <MapView tile={tile} visible={visible} hideSeen={hideSeen} discovered={discoveredSet} gems={gemSet} fly={fly} onPick={onPick} />
            : <AtlasView atlas={atlas} mode={mode} colorBy={colorBy} selectedId={selectedId} visible={visible} hideSeen={hideSeen} discovered={discoveredSet} scores={scores} focusCluster={cluster} flySeq={atlasFly} onPick={onPick} onCluster={openCluster} />}
          <AskBox current={selectedId} onAnswer={(ids) => spot(ids, ids.length ? 'from your question' : '')} onPick={flyPick} />
          <div className="mode-switch" role="tablist">
            {MODES.map((m) => (
              <button key={m.key} role="tab" className={mode === m.key ? 'on' : ''} title={m.title} disabled={m.key !== 'islands' && !atlas} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          {mode !== 'islands' && atlas && (
            <div className="atlas-caption">
              {mode === 'meaning'
                ? <>t-SNE of {atlas.points.length.toLocaleString()} startups by what they do · {atlas.clusters.length} themes found by k-means · click a theme name to read its market</>
                : <>t-SNE of {atlas.logos.length.toLocaleString()} logos by how they look (CLIP) · zoom in, or search the logo tab with words or a picture</>}
            </div>
          )}
          <button className="chip recenter" title="Back to the selected startup (r)" onClick={() => flyTo(tile.x, tile.y)}><Icon name="target" /> recenter</button>

          {drawer !== 'none' && (
            <div className="drawer">
              <div className="drawer-head">
                <span>{drawer === 'search' ? 'search' : drawer === 'gems' ? 'gems' : drawer === 'cluster' ? 'market read' : drawer === 'results' ? results?.label : openIsland}</span>
                <button className="icon-btn" onClick={() => { if (drawer === 'cluster' || drawer === 'results') clearSpot(); setDrawer('none') }}>✕</button>
              </div>
              {drawer === 'search' && (
                <SearchPanel atlas={atlas} current={selectedId} onPick={select} tab={searchTab}
                  setTab={(t) => { setSearchTab(t); if (t === 'logos' && mode !== 'logos') setMode('logos'); if (t === 'meaning' && mode === 'logos') setMode('meaning') }}
                  onResults={(r) => { showResults(r); if (r && searchTab === 'meaning' && mode !== 'meaning') setMode('meaning') }} />
              )}
              {drawer === 'cluster' && atlas && cluster !== null && (
                <ClusterPanel atlas={atlas} index={cluster} current={selectedId} onPick={select} onInvestor={(id) => setFilters((f) => ({ ...f, investor: id }))} onSpot={(ids) => spot(ids, 'named by Cala')} />
              )}
              {drawer === 'results' && results && <LogoGrid atlas={atlas} items={results.hits} current={selectedId} onPick={select} />}
              {drawer === 'gems' && <StartupList items={[...gemSet].map((id) => BY_ID.get(id)!.startup!)} current={selectedId} onPick={select} empty="nothing gemmed yet, press g on a startup" />}
              {drawer === 'island' && (
                <>
                  <StartupList items={islandMembers} current={selectedId} onPick={select} empty="empty island, use “add to island” on a startup" />
                  <button className="danger" onClick={() => { setLists(Object.fromEntries(Object.entries(lists).filter(([n]) => n !== openIsland))); setDrawer('none') }}>delete island</button>
                </>
              )}
            </div>
          )}

          <div className="filters">
            <div className="filter-tools">
              <button className={`chip ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}><Icon name="down" size={10} /> filters</button>
              <button className={`chip ${hideSeen ? 'active' : ''}`} title="Dim the startups you have already opened" onClick={() => setHideSeen(!hideSeen)}><Icon name="dots" /> dim seen</button>
              {spotlight.length > 0 && <button className="chip active" title="Show all startups again" onClick={clearSpot}><Icon name="spark" /> {spotlight.length} · {spotLabel.length > 34 ? `${spotLabel.slice(0, 33)}…` : spotLabel} ✕</button>}
              {mode === 'meaning' && atlas && (
                <label className="chip label color-by">
                  <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
                    {COLOR_BY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <span className="k">colour</span><span>{COLOR_BY.find((c) => c.key === colorBy)?.label}</span><Icon name="down" size={9} />
                </label>
              )}
              {mode === 'meaning' && atlas && colorBy === 'stage' && (
                <span className="chip legend">{STAGE_LEGEND.filter(([k]) => k !== 'Unknown').map(([k, c]) => <span key={k}><i style={{ background: `rgb(${c.join(',')})` }} />{k}</span>)}</span>
              )}
              {mode === 'meaning' && atlas && (colorBy === 'funding' || colorBy === 'age') && (
                <span className="chip legend"><span>{colorBy === 'funding' ? 'none' : 'older'}</span><i className="ramp-bar" /><span>{colorBy === 'funding' ? '€100M+' : 'newer'}</span></span>
              )}
              {filtering && <span className="chip count">{visible.size} startups</span>}
              {filtering && <button className="chip" onClick={() => setFilters(NO_FILTERS)}>clear ✕</button>}
              {filtering && <button className="chip" title="Save these filters" onClick={() => setSavedFilters([...savedFilters, filters])}><Icon name="save" /> save</button>}
              {savedFilters.map((f, i) => (
                <button key={i} className="chip" title={Object.values(f).filter(Boolean).join(' · ')} onClick={() => setFilters(f)}>★ {Object.values(f).filter(Boolean).join(' · ').slice(0, 24)}</button>
              ))}
            </div>
            {showFilters && filterRows.map((row) => (
              <label key={row.key} className={`chip label ${filters[row.key] ? 'active' : ''}`}>
                <select value={filters[row.key]} onChange={(e) => setFilters((f) => ({ ...f, [row.key]: e.target.value }))}>
                  <option value="">any {row.label}</option>
                  {row.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <span className="k">{row.label}</span>
                <span>{filters[row.key] || 'any'}</span>
                <Icon name="down" size={9} />
              </label>
            ))}
            {filters.investor && (
              <button className="chip label active" title="Remove investor filter" onClick={() => toggleFilter('investor', filters.investor)}>
                <span className="k">investor</span>
                <span>{STARTUPS.flatMap((s) => s.investors).find((i) => i.id === filters.investor)?.name ?? 'investor'} ✕</span>
              </button>
            )}
          </div>
        </div>

        <footer className="transport">
          <button className="t-btn" title="Previous (p)" onClick={previous} disabled={!history.length}><Icon name="prev" /><span>back</span></button>
          <button className={`t-btn ${sofa ? 'on' : ''}`} title="Autopilot: sail to a new startup every few seconds (space)" onClick={toggleSofa}>
            <Icon name={sofa ? 'pause' : 'boat'} size={18} /><span>{sofa ? 'stop autopilot' : 'autopilot'}</span>
            {sofa && <SofaBar hopAt={hopAt} />}
          </button>
          <button className="t-btn wide" title="Nearest startup you have not seen yet (n)" onClick={next}><span>next startup</span><Icon name="next" /></button>
        </footer>
      </main>

      <aside className="right">
        <section className="block cover" key={selected.id}>
          <div className="postcard">
            {[-3, -2, -1, 0, 1, 2, 3].map((dy) => [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((dx) => {
              const t = LAND.get(`${tile.x + dx},${tile.y + dy}`)
              return <i key={`${dx},${dy}`} style={{ background: t ? `rgb(${t.color.join(',')})` : 'transparent' }} />
            }))}
            <Logo name={selected.name} website={selected.website} color={tile.color} className="postcard-logo" />
          </div>
          <div className="cover-text">
            <h2>{selected.name}</h2>
            <div className="facts">
              {partner && (
                <button className="tag bridge" title={`Sits on the land joining ${selected.sector} and ${partner.sector}: sail over`} onClick={() => flyTo(partner.cx, partner.cy, 3.6)}>⇄ also {partner.sector}</button>
              )}
              {facts.map((f) => (
                <button key={f.key} className={`tag ${filters[f.key] === f.value ? 'on' : ''}`} title={filters[f.key] === f.value ? 'Remove this filter' : `Show only ${f.text} on the map`} onClick={() => toggleFilter(f.key, f.value)}>{f.text}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="actions">
          <button className={`a-btn gem-btn ${isGem ? 'on' : ''}`} title="Gem (g)" onClick={toggleGem}><Icon name="gem" /><span>{isGem ? 'gemmed' : 'gem'}</span></button>
          <div className="add-wrap">
            <button className="a-btn wide" onClick={() => setAddMenu(!addMenu)}><Icon name="save" /><span>add to island</span></button>
            {addMenu && (
              <div className="menu">
                {Object.keys(lists).map((n) => {
                  const inIt = lists[n].includes(selected.id)
                  return <button key={n} className={inIt ? 'on' : ''} onClick={() => setLists({ ...lists, [n]: inIt ? lists[n].filter((x) => x !== selected.id) : [...lists[n], selected.id] })}>{inIt ? '✓ ' : ''}{n}</button>
                })}
                <button className="muted" onClick={() => { setAddMenu(false); setNewIsland('') }}>+ new island</button>
              </div>
            )}
          </div>
        </section>

        <section className="block">
          <div className="section-title">Island <b>{selected.sector}</b></div>
          <StartupList items={neighbours} current={selectedId} onPick={select} meta={(s) => s.country} />
        </section>

        <Twins atlas={atlas} id={selected.id} onPick={flyPick} onMoreLogos={moreLogos} onInvestor={(id) => toggleFilter('investor', id)} />

        <section className="block about card-in" key={`about-${selected.id}`}>
          <div className="section-title">About</div>
          {summaries[selected.id] ? (
            <>
              <p className="pitch">{summaries[selected.id].summary}</p>
              <p className="ai-note">
                <Icon name="spark" size={11} /> {summaries[selected.id].grounded === false ? 'Gemini, from Cala facts' : 'Gemini, from the web'}
                {summaries[selected.id].sources.map((s) => <a key={s.uri} href={s.uri} target="_blank" rel="noreferrer">{s.title}</a>)}
              </p>
              {selected.description && <p className="cala-line"><span>Cala</span> {selected.description}</p>}
            </>
          ) : <p className="pitch">{selected.description || 'No description yet.'}</p>}
          <dl>
            {selected.totalFunding
              ? <><dt>raised</dt><dd>{money(selected.totalFunding.value, selected.totalFunding.units)} <Src s={prov?.total_funding} /></dd></>
              : selected.funding && <><dt>raised</dt><dd>{selected.funding}</dd></>}
            {selected.stage !== 'Unknown' && <><dt>stage</dt><dd>{selected.stage} <Src s={prov?.funding_stage} /></dd></>}
            {selected.headcount && <><dt>team</dt><dd>{selected.headcount} people <Src s={prov?.employee_count_range} /></dd></>}
            {selected.founded && <><dt>founded</dt><dd>{selected.founded} <Src s={prov?.founding_date} /></dd></>}
            {selected.hq && <><dt>hq</dt><dd>{selected.hq.replace(/^[\s,]+/, '')} <Src s={prov?.headquarters_address} /></dd></>}
            {selected.ceo?.length ? <><dt>ceo</dt><dd>{selected.ceo.map((f) => f.name).join(', ')}</dd></> : null}
            {selected.founders.length > 0 && <><dt>founders</dt><dd>{selected.founders.map((f) => f.name).join(', ')}</dd></>}
            {selected.status && selected.status !== 'ACTIVE' && <><dt>status</dt><dd>{selected.status.toLowerCase()} <Src s={prov?.operational_status} /></dd></>}
          </dl>
          <div className="section-title">Backed by</div>
          <div className="chips">
            {selected.investors.length === 0 && <span className="muted">no investors on record yet</span>}
            {(allInvestors ? selected.investors : selected.investors.slice(0, 12)).map((b) => (
              <button key={b.id} className={`tag ${filters.investor === b.id ? 'on' : ''}`} title="Light up this investor's portfolio" onClick={() => toggleFilter('investor', b.id)}>{b.name}</button>
            ))}
            {selected.investors.length > 12 && <button className="tag" onClick={() => setAllInvestors(!allInvestors)}>{allInvestors ? 'show fewer' : `+${selected.investors.length - 12} more`}</button>}
          </div>
          <LiveRounds startup={selected} onInvestor={(id) => toggleFilter('investor', id)} />
        </section>

        <FounderView startup={selected} onInvestor={(id) => setFilters((f) => ({ ...f, investor: id }))} onPick={flyPick} />

        <section className="block footer-link">
          {selected.website
            ? <a href={`https://${selected.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer"><Icon name="link" size={12} /> Visit {selected.website}</a>
            : <span className="muted">{IS_MOCK ? 'Mock data' : 'Data from Cala'}</span>}
          <button className="copy" onClick={copyLink}><Icon name="link" size={12} /> {copied ? 'Link copied' : 'Copy link to this startup'}</button>
        </section>
      </aside>
    </div>
  )
}

function StartupList({ items, current, onPick, meta, empty }: { items: Startup[]; current: string; onPick: (id: string) => void; meta?: (s: Startup) => string; empty?: string }) {
  if (!items.length) return <p className="muted pad">{empty}</p>
  return (
    <ul className="track-list">
      {items.map((s) => {
        const t = BY_ID.get(s.id)!
        return (
          <li key={s.id} className={s.id === current ? 'current' : ''} onClick={() => onPick(s.id)}>
            <img src={sigilUrl(s.name, t.color)} alt="" />
            <span className="name">{s.name}</span>
            <span className="meta">{meta ? meta(s) : s.sector}</span>
          </li>
        )
      })}
    </ul>
  )
}

// Own clock so the progress bar animates without re-rendering the whole app.
function SofaBar({ hopAt }: { hopAt: number }) {
  const clock = useClock(20)
  const progress = Math.min(1, Math.max(0, clock - hopAt) / SOFA_SECONDS)
  return <i className="bar-fill" style={{ width: `${progress * 100}%` }} />
}
