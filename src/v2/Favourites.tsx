import { useState } from 'react'
import { sendMagicLink, signOut, supabase } from '../auth'
import { LogoImg } from './Logo'
import { money, type World } from './world'

// The "Saved" sheet: your shortlist of startups, with export and (when Supabase is configured) sync.
export function FavSheet({ world, ids, email, onPick, onRemove, onClose }: {
  world: World; ids: string[]; email?: string; onPick: (i: number) => void; onRemove: (id: string) => void; onClose: () => void
}) {
  const [mail, setMail] = useState('')
  const [msg, setMsg] = useState('')
  // Which action button just fired: shows a tick for a moment.
  const [done, setDone] = useState<'csv' | 'copy' | ''>('')
  const flash = (k: 'csv' | 'copy') => { setDone(k); setTimeout(() => setDone(''), 1500) }
  const rows = ids.map((id) => world.index.get(id)).filter((i): i is number => i !== undefined)
  const csv = () => {
    const head = ['name', 'country', 'theme', 'founded', 'raised_eur', 'valuation_eur']
    const lines = rows.map((i) => [world.name[i], world.countries[world.country[i]], world.themes[world.cluster[i]].label, world.founded[i] || '', world.raised[i] || '', world.value[i] || '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'saved-startups.csv'; a.click()
    URL.revokeObjectURL(url)
    flash('csv')
  }
  const copy = () => { navigator.clipboard?.writeText(rows.map((i) => world.name[i]).join('\n')); flash('copy') }
  return (
    <aside className="v2-sheet glass">
      <div className="sheet-head"><h3>Saved startups <span className="muted">{rows.length}</span></h3><button className="close" onClick={onClose}>✕</button></div>
      {rows.length === 0 && <p className="muted">Nothing saved yet. Open a startup and press Save, or press F while a card is open.</p>}
      <ul className="list">
        {rows.map((i) => (
          <li key={i} onClick={() => onPick(i)}>
            <LogoImg world={world} i={i} />
            <span className="txt"><b>{world.name[i]}</b><small>{world.countries[world.country[i]]}{world.value[i] ? ` · valued ${money(world.value[i])}` : ''}</small></span>
            <button className="mini-x" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(world.id[i]) }}>✕</button>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="actions">
          <button className={done === 'csv' ? 'done' : ''} onClick={csv}>{done === 'csv' ? '✓ Downloaded' : 'Download CSV'}</button>
          <button className={done === 'copy' ? 'done' : ''} onClick={copy}>{done === 'copy' ? '✓ Copied' : 'Copy names'}</button>
        </div>
      )}
      <div className="sync">
        {!supabase && <p className="muted">Saved on this device. To sync across devices, create a Supabase project, run <code>supabase/schema.sql</code> and put its URL and anon key in <code>.env</code> as <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</p>}
        {supabase && email && <p className="muted">Synced to your account ({email}). <button className="link" onClick={() => signOut()}>Sign out</button></p>}
        {supabase && !email && (
          <form onSubmit={async (e) => { e.preventDefault(); setMsg('Sending…'); setMsg((await sendMagicLink(mail)) ?? 'Check your inbox and click the link to sign in.') }}>
            <p className="muted">Enter your email to keep this list on every device. We send you a sign-in link, no password.</p>
            <div className="signin"><input type="email" required placeholder="you@email.com" value={mail} onChange={(e) => setMail(e.target.value)} /><button className="primary">Send link</button></div>
            {msg && <p className="muted">{msg}</p>}
          </form>
        )}
      </div>
    </aside>
  )
}
