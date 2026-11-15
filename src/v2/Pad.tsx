import { useRef, useState } from 'react'

// Touch controls for the boat: a joystick that presses W/A/S/D for you, and Open (E) / Save (F) buttons.
// They send the same key events the keyboard does, so the map needs no touch code of its own.
const KEYS = { u: ['KeyW', 'w'], d: ['KeyS', 's'], l: ['KeyA', 'a'], r: ['KeyD', 'd'] } as const
type Dir = keyof typeof KEYS
const send = (type: 'keydown' | 'keyup', [code, key]: readonly [string, string]) => window.dispatchEvent(new KeyboardEvent(type, { code, key }))
const tap = (k: readonly [string, string]) => { send('keydown', k); send('keyup', k) }

export function Pad({ canSave }: { canSave: boolean }) {
  const held = useRef(new Set<Dir>())
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState<[number, number]>([0, 0])
  const on = useRef(false)

  const press = (next: Set<Dir>) => {
    for (const d of held.current) if (!next.has(d)) send('keyup', KEYS[d])
    for (const d of next) if (!held.current.has(d)) send('keydown', KEYS[d])
    held.current = next
  }
  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    const R = r.width / 2
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R)
    const d = Math.hypot(dx, dy)
    if (d > R) { dx *= R / d; dy *= R / d }
    setKnob([dx, dy])
    // A dead zone in the middle, then 8 directions.
    const next = new Set<Dir>()
    if (d > R * 0.25) {
      const a = Math.atan2(dy, dx)
      if (Math.cos(a) > 0.38) next.add('r')
      if (Math.cos(a) < -0.38) next.add('l')
      if (Math.sin(a) > 0.38) next.add('d')
      if (Math.sin(a) < -0.38) next.add('u')
    }
    press(next)
  }
  const end = () => { on.current = false; setKnob([0, 0]); press(new Set()) }

  return (
    <div className="pad" aria-label="Boat controls">
      <div className="pad-actions">
        <button className="pad-btn" onClick={() => tap(['KeyE', 'e'])} aria-label="Open the nearest startup">Open</button>
        {canSave && <button className="pad-btn save" onClick={() => tap(['KeyF', 'f'])} aria-label="Save this startup">Save</button>}
      </div>
      <div
        ref={base}
        className="pad-stick"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); on.current = true; move(e) }}
        onPointerMove={(e) => { if (on.current) move(e) }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <i style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
      </div>
    </div>
  )
}
