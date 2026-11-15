import { rng } from './data/mock'
import type { Startup } from './data/types'
import { perlin } from './perlin'

export interface Tile {
  x: number
  y: number
  sector: string
  startup?: Startup
  color: [number, number, number]
}

export interface Island {
  sector: string
  cx: number
  cy: number
  radius: number
  color: [number, number, number]
}

// 2D position per startup id, each axis in [0, 1]; neighbours = similar companies.
export type Positions = Record<string, [number, number]>

const PALETTE: [number, number, number][] = [
  [120, 70, 95], [90, 80, 130], [70, 105, 100], [125, 95, 60], [100, 60, 120], [130, 75, 70],
  [70, 90, 125], [105, 115, 70], [125, 70, 115], [80, 110, 120], [115, 85, 95], [95, 100, 85],
  [110, 90, 120], [85, 115, 95],
]
// Every land tile is a startup: bare land looked clickable but was not.
const LAND_PER_STARTUP = 1

interface Shape {
  lobes: { x: number; y: number; r: number }[]
  angle: number
  stretch: number
  rough: number
  freq: number
}

// Each island draws its own silhouette: one to three lobes, stretched and rotated,
// with its own coast roughness. Same recipe everywhere would give lookalike blobs.
function randomShape(r: () => number): Shape {
  const lobes = [{ x: 0, y: 0, r: 1 }]
  const extra = Math.floor(r() * 3)
  for (let k = 0; k < extra; k++) {
    const a = r() * Math.PI * 2
    const d = 0.8 + r() * 0.7
    lobes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.45 + r() * 0.5 })
  }
  return { lobes, angle: r() * Math.PI, stretch: 1 + r() * 0.4, rough: 0.5 + r() * 1.1, freq: 0.9 + r() * 1.3 }
}

// Land = the `area` cells where fractal noise minus distance to the nearest lobe is highest,
// so an island keeps its area whatever its shape. Cells are relative to the island origin.
function islandCells(area: number, shape: Shape, noise: (x: number, y: number) => number, offset: number) {
  const radius = Math.sqrt(area / Math.PI)
  const reach = Math.ceil(radius * 3.2)
  const [cos, sin] = [Math.cos(shape.angle), Math.sin(shape.angle)]
  const scored: { x: number; y: number; s: number }[] = []
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const u = ((dx * cos + dy * sin) / radius) / shape.stretch
      const v = ((dy * cos - dx * sin) / radius) * shape.stretch
      const d = Math.min(...shape.lobes.map((l) => Math.hypot(u - l.x, v - l.y) / l.r))
      const n = noise(u * shape.freq + offset, v * shape.freq + offset)
      scored.push({ x: dx, y: dy, s: n * shape.rough - d })
    }
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, area)
}

const key = (x: number, y: number) => (x + 5000) * 10000 + (y + 5000)

// Startup that sits between its own sector and `to`; these live on the land joining the two islands.
export interface BridgeLink { id: string; to: string }

// Drops an island at the free spot nearest `anchor` along random bearings: a scattered
// archipelago with uneven straits instead of rows and columns.
function place(cells: { x: number; y: number }[], blocked: Set<number>, r: () => number, anchor: [number, number]) {
  for (let ring = 0; ; ring++) {
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2
      // Wider than tall, to suit landscape screens.
      const ox = Math.round(anchor[0] + Math.cos(a) * ring * 2.4)
      const oy = Math.round(anchor[1] + Math.sin(a) * ring * 1.5)
      if (cells.every((c) => !blocked.has(key(c.x + ox, c.y + oy)))) return { ox, oy }
    }
  }
}

const mix = (a: Tile['color'], b: Tile['color'], t: number) => a.map((v, i) => v + (b[i] - v) * t) as Tile['color']

// A winding strip of land from shore a to shore b, widened until it can hold `count` startups.
// Returns new cells ordered from a to b, with t = 0..1 along the neck.
function neck(a: { x: number; y: number }, b: { x: number; y: number }, count: number, land: Set<number>, noise: (x: number, y: number) => number, seed: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const [nx, ny] = [-(b.y - a.y) / (len || 1), (b.x - a.x) / (len || 1)]
  const steps = Math.ceil(len * 3)
  const spine = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    // Bends in the middle, pinned at both shores.
    const bend = noise(t * 1.7 + seed, seed) * len * 0.35 * Math.sin(Math.PI * t)
    return { x: a.x + (b.x - a.x) * t + nx * bend, y: a.y + (b.y - a.y) * t + ny * bend, t }
  })
  let cells: { x: number; y: number; t: number; d: number }[] = []
  // Starts ~3 tiles wide so it reads as land, then widens until every startup fits:
  // a startup without a tile would crash the panel lists.
  for (let half = 1.2; cells.length < count && half < 40; half += 0.4) {
    const found = new Map<number, { x: number; y: number; t: number; d: number }>()
    for (const p of spine) {
      const w = half * (0.8 + 0.4 * noise(p.t * 3 + seed, seed + 5))
      for (let x = Math.floor(p.x - w); x <= Math.ceil(p.x + w); x++) {
        for (let y = Math.floor(p.y - w); y <= Math.ceil(p.y + w); y++) {
          const d = Math.hypot(x - p.x, y - p.y)
          const k = key(x, y)
          if (d > w || land.has(k)) continue
          const prev = found.get(k)
          if (!prev || d < prev.d) found.set(k, { x, y, t: p.t, d })
        }
      }
    }
    cells = [...found.values()]
  }
  return cells.sort((p, q) => p.t - q.t)
}

export function layoutIslands(startups: Startup[], sectors: string[], positions: Positions = {}, links: BridgeLink[] = []) {
  const r = rng(23)
  const noise = perlin(11)
  const blocked = new Set<number>()
  const sectorOf = new Map(startups.map((s) => [s.id, s.sector]))
  const pairKey = (a: string, b: string) => [a, b].sort().join('|')
  const size = new Map<string, number>()
  for (const s of startups) size.set(s.sector, (size.get(s.sector) ?? 0) + 1)
  const necks = new Map<string, BridgeLink[]>()
  const onNeck = new Set<string>()
  const leaving = new Map<string, number>()
  for (const l of links) {
    const from = sectorOf.get(l.id)
    if (!from || from === l.to || !size.has(l.to) || onNeck.has(l.id)) continue
    // At most half an island moves onto necks, so every island keeps land of its own.
    if ((leaving.get(from) ?? 0) >= Math.floor(size.get(from)! / 2)) continue
    leaving.set(from, (leaving.get(from) ?? 0) + 1)
    onNeck.add(l.id)
    necks.set(pairKey(from, l.to), [...(necks.get(pairKey(from, l.to)) ?? []), l])
  }
  const weight = (a: string, b: string) => necks.get(pairKey(a, b))?.length ?? 0
  const pending = sectors.map((sector, i) => ({ sector, color: PALETTE[i % PALETTE.length], members: startups.filter((s) => s.sector === sector && !onNeck.has(s.id)) }))
  const placed: { sector: string; color: Tile['color']; members: Startup[]; cells: { x: number; y: number }[]; cx: number; cy: number }[] = []

  // Biggest island first, then always the one most linked to what is already placed, dropped
  // next to its partners: shared themes become neighbouring shores.
  while (pending.length) {
    const ties = (g: (typeof pending)[number]) => placed.reduce((a, p) => a + weight(g.sector, p.sector), 0)
    pending.sort((a, b) => ties(b) - ties(a) || b.members.length - a.members.length)
    const g = pending.shift()!
    const partners = placed.map((p) => ({ p, w: weight(g.sector, p.sector) })).filter((x) => x.w)
    const total = partners.reduce((a, x) => a + x.w, 0)
    const anchor: [number, number] = total
      ? [partners.reduce((a, x) => a + x.p.cx * x.w, 0) / total, partners.reduce((a, x) => a + x.p.cy * x.w, 0) / total]
      : [0, 0]
    const local = islandCells(Math.ceil(g.members.length * LAND_PER_STARTUP), randomShape(r), noise, placed.length * 7.3)
    const { ox, oy } = place(local, blocked, r, anchor)
    const cells = local.map((c) => ({ x: c.x + ox, y: c.y + oy }))
    const strait = 3 + Math.floor(r() * 5)
    for (const c of cells) {
      for (let dx = -strait; dx <= strait; dx++) for (let dy = -strait; dy <= strait; dy++) blocked.add(key(c.x + dx, c.y + dy))
    }
    placed.push({ ...g, cells, cx: cells.reduce((a, c) => a + c.x, 0) / cells.length, cy: cells.reduce((a, c) => a + c.y, 0) / cells.length })
  }

  const tiles: Tile[] = []
  const islands: Island[] = []
  // One jitter for all channels: brightness varies, hue stays the island's.
  const shade = (c: Tile['color']) => { const j = (r() - 0.5) * 36; return c.map((v) => Math.max(0, Math.min(255, v + j))) as Tile['color'] }
  for (const { sector, color, members, cells, cx, cy } of placed) {
    const startupAt = assign(members, cells, positions, r)
    for (const c of cells) {
      const s = startupAt.get(`${c.x},${c.y}`)
      tiles.push({ x: c.x, y: c.y, sector, startup: s, color: s ? shade(color) : (shade(color).map((v) => v * 0.55) as Tile['color']) })
    }
    islands.push({ sector, cx, cy, radius: Math.sqrt(cells.length / Math.PI), color })
  }

  // Land necks: in-between startups fill a strip from the nearest shores of the two islands,
  // each one on its own sector's side, with the colour blending across.
  const land = new Set(tiles.map((t) => key(t.x, t.y)))
  const byId = new Map(startups.map((s) => [s.id, s]))
  let seed = 0
  for (const [pair, members] of necks) {
    const [A, B] = pair.split('|').map((sec) => placed.find((p) => p.sector === sec)!)
    if (!A || !B) continue
    let best = { a: A.cells[0], b: B.cells[0], d: Infinity }
    for (const a of A.cells) for (const b of B.cells) {
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      if (d < best.d) best = { a, b, d }
    }
    const cells = neck(best.a, best.b, members.length, land, noise, ++seed * 3.1)
    const fromA = members.filter((l) => sectorOf.get(l.id) === A.sector)
    const fromB = members.filter((l) => sectorOf.get(l.id) === B.sector)
    // A's startups take the cells nearest A, B's the ones nearest B, the middle stays bare.
    const slots = [...fromA.map((l, i) => ({ l, cell: cells[i] })), ...fromB.map((l, i) => ({ l, cell: cells[cells.length - 1 - i] }))]
    const taken = new Map(slots.filter((x) => x.cell).map((x) => [key(x.cell.x, x.cell.y), byId.get(x.l.id)!]))
    for (const c of cells) {
      const s = taken.get(key(c.x, c.y))
      const color = shade(mix(A.color, B.color, c.t))
      land.add(key(c.x, c.y))
      tiles.push({ x: c.x, y: c.y, sector: s?.sector ?? (c.t < 0.5 ? A.sector : B.sector), startup: s, color: s ? color : (color.map((v) => v * 0.75) as Tile['color']) })
    }
  }
  const partnerOf = new Map(links.filter((l) => onNeck.has(l.id)).map((l) => [l.id, l.to]))
  return { tiles, islands, partnerOf }
}

// Greedy match of each startup to the free land cell closest to its similarity position.
function assign(members: Startup[], cells: { x: number; y: number }[], positions: Positions, r: () => number) {
  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const free = cells.map((c) => ({ ...c, u: (c.x - x0) / (x1 - x0 || 1), v: (c.y - y0) / (y1 - y0 || 1) }))
  const out = new Map<string, Startup>()
  const order = [...members].sort((a, b) => (positions[a.id] ? 0 : 1) - (positions[b.id] ? 0 : 1))
  for (const s of order) {
    const [u, v] = positions[s.id] ?? [0.5 + (r() - 0.5) * 0.6, 0.5 + (r() - 0.5) * 0.6]
    let best = 0
    let bestD = Infinity
    free.forEach((c, k) => {
      const d = (c.u - u) ** 2 + (c.v - v) ** 2
      if (d < bestD) [best, bestD] = [k, d]
    })
    const [c] = free.splice(best, 1)
    if (c) out.set(`${c.x},${c.y}`, s)
  }
  return out
}

// Fingerprint of everything the layout depends on, so a precomputed layout is only reused for
// the exact same data.
export function layoutKey(startups: Startup[], positions: Positions, links: BridgeLink[]) {
  const text = JSON.stringify([startups.map((s) => [s.id, s.sector]), positions, links])
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return `${startups.length}-${(h >>> 0).toString(36)}`
}

type Layout = ReturnType<typeof layoutIslands>
export interface PackedLayout {
  key: string
  tiles: [number, number, string, string | null, number, number, number][]
  islands: Island[]
  partner: [string, string][]
}

export const packLayout = (key: string, l: Layout): PackedLayout => ({
  key,
  tiles: l.tiles.map((t) => [t.x, t.y, t.sector, t.startup?.id ?? null, ...t.color.map(Math.round)] as PackedLayout['tiles'][number]),
  islands: l.islands,
  partner: [...l.partnerOf],
})

export function unpackLayout(p: PackedLayout, startups: Startup[]): Layout {
  const byId = new Map(startups.map((s) => [s.id, s]))
  return {
    tiles: p.tiles.map(([x, y, sector, id, r, g, b]) => ({ x, y, sector, startup: id ? byId.get(id) : undefined, color: [r, g, b] })),
    islands: p.islands,
    partnerOf: new Map(p.partner),
  }
}
