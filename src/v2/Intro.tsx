import { useEffect, useState } from 'react'
import { FISHERMAN } from './sprites'

// [X] shows as a keyboard key.
const PAGES = [
  'Moi, moi! I am Eino. Forty winters I fished the Baltic, and now I fish for startups. The catch is smaller, the pitch decks are longer.',
  'Every dot is a young startup. Big dots are big fish, small dots are plankton with a pitch deck. The one in Barcelona is Cala, my favourite catch.',
  'Sail with [W] [A] [S] [D], and press [E] to haul one in. Mind the nets. Kippis!',
]

// Turns "[W]" into a keycap; a bracket still being typed is hidden until it closes.
function keys(text: string) {
  const open = text.lastIndexOf('[')
  const safe = open > text.lastIndexOf(']') ? text.slice(0, open) : text
  return safe.split(/(\[[^\]]+\])/).map((part, i) => (part.startsWith('[') ? <kbd key={i}>{part.slice(1, -1)}</kbd> : part))
}

const KEY = 'unicorn-isles-intro'
export const introSeen = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const markSeen = () => { try { localStorage.setItem(KEY, '1') } catch { /* private window */ } }

// Eino greets you on the first visit and explains the chart and the controls.
export function Intro({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0)
  const [shown, setShown] = useState(0)
  const text = PAGES[page]
  useEffect(() => {
    setShown(0)
    const id = setInterval(() => setShown((n) => (n >= text.length ? n : n + 2)), 22)
    return () => clearInterval(id)
  }, [text])
  const done = shown >= text.length
  const close = () => { markSeen(); onClose() }
  const next = () => {
    if (!done) { setShown(text.length); return }
    if (page === PAGES.length - 1) close()
    else setPage(page + 1)
  }
  useEffect(() => {
    // Captured first, so the boat and shortcuts stay quiet while Eino talks.
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      e.stopImmediatePropagation()
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); next() }
      if (e.key === 'Escape') close()
    }
    const quiet = (e: KeyboardEvent) => e.stopImmediatePropagation()
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', quiet, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', quiet, true) }
  })
  return (
    <div className="intro" role="dialog" aria-label="Welcome">
      <div className="intro-card glass">
        <img className="eino" src={FISHERMAN.url} width={FISHERMAN.width} height={FISHERMAN.height} alt="Eino, an old Finnish fisherman" />
        <div className="intro-body">
          <div className="intro-name">Eino <span>old fisherman of the Unicorn Isles</span></div>
          <p>{keys(text.slice(0, shown))}<i className={done ? 'caret off' : 'caret'} /></p>
          <div className="intro-actions">
            <span className="dots">{PAGES.map((_, k) => <b key={k} className={k === page ? 'on' : ''} />)}</span>
            <button className="skip" onClick={close}>Skip</button>
            <button className="primary" onClick={next}>{page === PAGES.length - 1 && done ? 'Let’s sail' : 'Next ›'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
