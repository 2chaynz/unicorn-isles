import { BRIDGE_LINKS, POSITIONS, SECTORS, STARTUPS } from './data/load'
import { layoutIslands, layoutKey, unpackLayout, type PackedLayout } from './layout'

// The archipelago is computed once, ahead of time by scripts/layout.mjs (data/layout.json), so the
// page does not spend its first half second on it. If the data changed since, compute it here.
// PARTNER: startup id -> the other island its land neck joins.
const packed = import.meta.glob<PackedLayout>('./data/layout.json', { eager: true, import: 'default' })['./data/layout.json']
const fresh = packed?.key === layoutKey(STARTUPS, POSITIONS, BRIDGE_LINKS)
if (packed && !fresh) console.warn('data/layout.json is stale: run node scripts/layout.mjs')
export const { tiles: TILES, islands: ISLANDS, partnerOf: PARTNER } = fresh
  ? unpackLayout(packed, STARTUPS)
  : layoutIslands(STARTUPS, SECTORS, POSITIONS, BRIDGE_LINKS)
export const BY_ID = new Map(TILES.filter((t) => t.startup).map((t) => [t.startup!.id, t]))
export const LAND = new Map(TILES.map((t) => [`${t.x},${t.y}`, t]))

const MARGIN = 8
const xs = TILES.map((t) => t.x)
const ys = TILES.map((t) => t.y)
export const BOUNDS = {
  x0: Math.min(...xs) - MARGIN,
  x1: Math.max(...xs) + MARGIN,
  y0: Math.min(...ys) - MARGIN,
  y1: Math.max(...ys) + MARGIN,
}

// Glints on open water inside the bounds.
export const SEA = (() => {
  const pts: { p: [number, number]; phase: number; speed: number }[] = []
  for (let i = 0; pts.length < 700 && i < 5000; i++) {
    const p: [number, number] = [
      Math.round(BOUNDS.x0 + Math.random() * (BOUNDS.x1 - BOUNDS.x0)),
      Math.round(BOUNDS.y0 + Math.random() * (BOUNDS.y1 - BOUNDS.y0)),
    ]
    if (!LAND.has(`${p[0]},${p[1]}`)) pts.push({ p, phase: Math.random() * 6.28, speed: 0.4 + Math.random() * 1.2 })
  }
  return pts
})()
