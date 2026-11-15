import { useEffect, useRef, useState } from 'react'

// Shared clock for map animations; ~30fps is plenty for bobbing and twinkling.
export function useClock(fps = 30) {
  const [t, setT] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last > 1000 / fps) {
        last = now
        setT(now / 1000)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fps])
  return t
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

export interface Voyage {
  pos: [number, number]
  heading: 1 | -1
  wake: [number, number][]
  sailing: boolean
}

// Sails the boat from its last position to `to` along a gentle arc, leaving a wake.
export function useVoyage(to: [number, number] | undefined, t: number, duration = 1.4): Voyage {
  const trip = useRef({ from: to ?? [0, 0], to: to ?? [0, 0], start: -Infinity })
  const wake = useRef<[number, number][]>([])
  const key = to ? `${to[0]},${to[1]}` : ''
  const lastKey = useRef(key)

  if (to && key !== lastKey.current) {
    lastKey.current = key
    const cur = position(trip.current, t, duration)
    trip.current = { from: cur, to, start: t }
  }

  const pos = position(trip.current, t, duration)
  const sailing = t - trip.current.start < duration
  if (sailing) {
    wake.current = [...wake.current, pos].slice(-40)
  } else if (wake.current.length) {
    wake.current = wake.current.slice(2)
  }
  const dx = trip.current.to[0] - trip.current.from[0]
  return { pos, heading: dx < 0 ? -1 : 1, wake: wake.current, sailing }
}

function position(trip: { from: [number, number]; to: [number, number]; start: number }, t: number, duration: number): [number, number] {
  const k = Math.min(1, Math.max(0, (t - trip.start) / duration))
  const e = ease(k)
  const [x0, y0] = trip.from
  const [x1, y1] = trip.to
  // Arc perpendicular to the route so long trips look sailed, not slid.
  const len = Math.hypot(x1 - x0, y1 - y0)
  const bulge = Math.sin(Math.PI * e) * Math.min(len * 0.15, 12)
  const nx = len ? -(y1 - y0) / len : 0
  const ny = len ? (x1 - x0) / len : 0
  return [x0 + (x1 - x0) * e + nx * bulge, y0 + (y1 - y0) * e + ny * bulge]
}
