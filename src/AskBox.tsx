import { useRef, useState } from 'react'
import { BY_ID } from './world'
import { Icon } from './icons'
import { sigilUrl } from './Logo'

export interface Pick { id: string; why: string }
interface Cala { answer?: string; sources?: { name: string; url: string }[]; entities?: { id: string; name: string }[]; error?: string }
interface Answer { answer: string; picks: Pick[]; model: string }

// Cala answers in markdown; the card shows plain prose, without headings or rules.
const plain = (md: string) => md.split('\n').filter((l) => !/^\s*(#|---)/.test(l)).join('\n')
  .replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim()
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]

const EXAMPLES = ['startups doing food and AI', 'seed-stage climate tech in Finland', 'who builds tools for game studios?']

// Natural-language search: the server shortlists by embedding, Gemini picks and explains.
export function AskBox({ current, onAnswer, onPick }: { current: string; onAnswer: (ids: string[]) => void; onPick: (id: string) => void }) {
  const [question, setQuestion] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Folded keeps the spotlight on the map but hides the card.
  const [folded, setFolded] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Answer | null>(null)
  const [calaOpen, setCalaOpen] = useState(false)
  // Cala answers on its own clock (up to a minute); 'pending' while it thinks.
  const [cala, setCala] = useState<Cala | 'pending' | null>(null)
  // Drops answers that arrive after a newer question was asked.
  const asked = useRef(0)

  const post = async (url: string, q: string) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? res.statusText)
    return body
  }

  async function submit(q: string) {
    if (!q.trim() || busy) return
    const n = ++asked.current
    setQuestion(q)
    setOpen(true)
    setFolded(false)
    setBusy(true)
    setError('')
    setCala('pending')
    setCalaOpen(false)
    // Either answer can land first (cached Cala answers are instant); the spotlight is their union.
    let mapIds: string[] = []
    let calaIds: string[] = []
    post('/api/cala', q)
      .then((body: Cala) => {
        if (n !== asked.current) return
        setCala(body)
        // Startups Cala names that are on our map light up too.
        calaIds = (body.entities ?? []).map((e) => e.id).filter((id) => BY_ID.has(id))
        if (calaIds.length) onAnswer([...new Set([...mapIds, ...calaIds])])
      })
      .catch((e) => n === asked.current && setCala({ error: e instanceof Error ? e.message : String(e) }))
    try {
      const body: Answer = await post('/api/ask', q)
      if (n !== asked.current) return
      setResult(body)
      mapIds = body.picks.map((p) => p.id).filter((id) => BY_ID.has(id))
      onAnswer([...new Set([...mapIds, ...calaIds])])
      if (mapIds[0]) onPick(mapIds[0])
    } catch (e) {
      if (n === asked.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (n === asked.current) setBusy(false)
    }
  }

  function close() {
    asked.current++
    setOpen(false)
    setResult(null)
    setCala(null)
    setBusy(false)
    onAnswer([])
  }

  return (
    <div className={`ask ${open ? 'open' : ''}`}>
      <form onSubmit={(e) => { e.preventDefault(); submit(question) }}>
        <Icon name="spark" size={14} />
        <input
          placeholder="Ask the archipelago… e.g. startups doing food and AI"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && close()}
        />
        {result && <button type="button" className="icon-btn" title={folded ? 'Show the answer' : 'Fold the answer'} onClick={() => setFolded(!folded)}>{folded ? '▾' : '▴'}</button>}
        {open && <button type="button" className="icon-btn" title="Close and clear the answer" onClick={close}>✕</button>}
      </form>
      {open && !folded && (
        <div className="ask-body">
          
          {error && <p className="ask-error">{error}</p>}
          {!busy && !result && !error && (
            <div className="chips">
              {EXAMPLES.map((q) => <button key={q} className="tag" onClick={() => submit(q)}>{q}</button>)}
            </div>
          )}
          {cala && (
            <section className="cala-live">
              <div className="ask-label"><span className={`live-dot ${cala === 'pending' ? 'pulse' : ''}`} /> Cala knowledge graph, live</div>
              {cala === 'pending'
                ? <p className="muted">Cala is researching its graph, this can take up to a minute…</p>
                : cala.error
                  ? <p className="muted">Live answer unavailable ({cala.error})</p>
                  : (
                    <>
                      <p className={`ask-answer ${calaOpen ? '' : 'clamped'}`} onClick={() => setCalaOpen(!calaOpen)} title={calaOpen ? '' : 'Show the full answer'}>{plain(cala.answer ?? '')}</p>
                      {(cala.entities ?? []).some((e) => BY_ID.has(e.id)) && (
                        <div className="chips">
                          {cala.entities!.filter((e) => BY_ID.has(e.id)).map((e) => <button key={e.id} className="tag" title="On the map: sail there" onClick={() => onPick(e.id)}>{e.name}</button>)}
                        </div>
                      )}
                      {(cala.sources ?? []).length > 0 && (
                        <p className="ask-note">sources {cala.sources!.map((src) => <a key={src.url} href={src.url} target="_blank" rel="noreferrer" title={src.name}>{host(src.url)}</a>)}</p>
                      )}
                    </>
                  )}
            </section>
          )}
          {busy && <p className="muted">Reading the map…</p>}
          {!busy && result && (
            <>
              <div className="ask-label"><Icon name="spark" size={10} /> On the map</div>
              <p className="ask-answer">{result.answer}</p>
              <ul className="track-list">
                {result.picks.filter((p) => BY_ID.has(p.id)).map((p) => {
                  const t = BY_ID.get(p.id)!
                  return (
                    <li key={p.id} className={p.id === current ? 'current' : ''} onClick={() => onPick(p.id)}>
                      <img src={sigilUrl(t.startup!.name, t.color)} alt="" />
                      <span className="pick">
                        <span className="name">{t.startup!.name} <span className="meta">{t.sector}</span></span>
                        <span className="why">{p.why}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="ask-note"><Icon name="spark" size={10} /> {result.model}, from Cala data and web summaries</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
