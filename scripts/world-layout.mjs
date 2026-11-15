// Europe layout: each country keeps its real outline (Natural Earth) and position. All countries share one
// scale, then resized about its own centre so its area follows its number of startups (outline unchanged).
// Countries that then overlap, or sit closer than BORDER cells, are nudged apart by the smallest amount,
// the smaller one moving more, so the map stays recognisable (France is a hexagon, Italy a boot).
// Inside its outline each country takes one whole grid cell per startup.
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'

const require = createRequire(import.meta.url)
const atlas = require('world-atlas/countries-50m.json')
const FEATURES = feature(atlas, atlas.objects.countries).features

// Our country names -> Natural Earth names where they differ.
const ALIAS = {
  'United States': 'United States of America', USA: 'United States of America', US: 'United States of America',
  'Czech Republic': 'Czechia', Türkiye: 'Turkey', 'Republic of Korea': 'South Korea', Korea: 'South Korea',
  UK: 'United Kingdom', England: 'United Kingdom', Scotland: 'United Kingdom', 'The Netherlands': 'Netherlands',
  'Bosnia and Herzegovina': 'Bosnia and Herz.', 'Dominican Republic': 'Dominican Rep.', UAE: 'United Arab Emirates',
  'Ivory Coast': "Côte d'Ivoire", 'Hong Kong SAR': 'Hong Kong',
}
const byName = new Map(FEATURES.map((f) => [f.properties.name, f]))

// The World lens shows Europe only (Russia and Turkey are mostly outside it).
export const EUROPE = new Set(['Finland', 'Sweden', 'Norway', 'Denmark', 'Iceland', 'Estonia', 'Latvia', 'Lithuania', 'Germany', 'France',
  'United Kingdom', 'Ireland', 'Netherlands', 'Belgium', 'Luxembourg', 'Switzerland', 'Austria', 'Spain', 'Portugal', 'Italy', 'Poland',
  'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia', 'Serbia', 'Bosnia and Herz.', 'Montenegro',
  'North Macedonia', 'Albania', 'Kosovo', 'Ukraine', 'Moldova', 'Belarus', 'Malta', 'Cyprus', 'Liechtenstein', 'Monaco', 'Andorra', 'San Marino'])
export const isEurope = (name) => EUROPE.has(ALIAS[name] ?? name)

const DEG = Math.PI / 180
// Equirectangular with longitude shrunk by cos(52 deg): close to how Europe looks on a map, without Mercator's inflated north.
const project = ([lon, lat]) => [lon * Math.cos(52 * DEG), -lat]
const FILL = 0.8 // share of an outline's cells that may hold a startup
const BORDER = 1 // empty cells kept between countries: a single cell, so neighbours sit along their real borders

const ringArea = (ring) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
// The biggest polygon of a country (mainland), projected; far islands would scatter its startups.
function mainland(f) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return polys.map((p) => p.map((ring) => ring.map(project))).sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0]
}
function inside([x, y], poly) {
  let hit = false
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}
const centroid = (ring) => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length]

// Integer cells inside a polygon after scaling it by s about c.
function cellsOf(poly, c, s) {
  const scaled = poly.map((ring) => ring.map(([x, y]) => [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s]))
  const xs = scaled[0].map((p) => p[0]), ys = scaled[0].map((p) => p[1])
  const cells = []
  for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) if (inside([x, y], scaled)) cells.push([x, y])
  }
  return cells
}

// Startups pinned to a real place on the map: id -> [lon, lat]. Cala sits in Barcelona, Catalonia.
export const PINS = { '81cfdabc-53f7-426a-b358-a942e159ca0f': [2.17, 41.39] }

// Cell offsets applied to a country's outline before anything is nudged apart.
const NUDGE = { Italy: [-6, 6], Ireland: [-1, -7] }

// rng: seeded random; orderKey: startup index order inside a country (similar startups end up adjacent).
export function worldLayout(countries, rng, orderKey, pins = new Map()) {
  const groups = new Map()
  countries.forEach((c, i) => { if (isEurope(c)) groups.set(c, [...(groups.get(c) ?? []), i]) })
  const items = []
  for (const [name, members] of groups) {
    const f = byName.get(ALIAS[name] ?? name)
    if (!f) continue
    const poly = mainland(f)
    items.push({ name, members, poly, c: centroid(poly[0]), area: ringArea(poly[0]) })
  }
  // One scale for everyone: the average country is about 60% full at real size.
  const k = Math.sqrt(items.reduce((a, it) => a + it.members.length, 0) / (0.6 * items.reduce((a, it) => a + it.area, 0)))
  for (const it of items) {
    const base = it.poly.map((ring) => ring.map(([x, y]) => [x * k, y * k]))
    const bc = [it.c[0] * k, it.c[1] * k]
    // Area follows the number of startups (never under a quarter of real size), so every outline fills in.
    let s = Math.max(0.25, Math.sqrt(it.members.length / (FILL * Math.max(1e-6, it.area * k * k))))
    let cells = cellsOf(base, bc, s)
    while (cells.length < it.members.length / FILL * 0.98 && s < 40) { s *= 1.05; cells = cellsOf(base, bc, s) }
    // A few countries are moved from where the projection puts them to where people expect them.
    const [nx, ny] = NUDGE[it.name] ?? [0, 0]
    if (nx || ny) cells = cells.map(([x, y]) => [x + nx, y + ny])
    it.cells = cells
    it.k = k; it.s = s; it.bc = [bc[0] + nx, bc[1] + ny]
    it.centre = it.bc
    it.off = [0, 0]
    // Cells within BORDER of the country at offset 0: the margin nobody else may enter.
    const halo = new Set()
    for (const [x, y] of cells) for (let dx = -BORDER; dx <= BORDER; dx++) for (let dy = -BORDER; dy <= BORDER; dy++) halo.add(`${x + dx},${y + dy}`)
    it.halo = halo
  }
  // Nudge apart: while two countries overlap or crowd each other, move both away from each other,
  // the one with fewer startups moving further.
  const at = (it) => [Math.round(it.off[0]), Math.round(it.off[1])]
  const clash = (a, b) => {
    const [ax, ay] = at(a), [bx, by] = at(b)
    for (const [x, y] of a.cells) if (b.halo.has(`${x + ax - bx},${y + ay - by}`)) return true
    return false
  }
  for (let pass = 0; pass < 1500; pass++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        if (!clash(a, b)) continue
        moved = true
        let dx = b.centre[0] + b.off[0] - (a.centre[0] + a.off[0]), dy = b.centre[1] + b.off[1] - (a.centre[1] + a.off[1])
        const len = Math.hypot(dx, dy) || 1
        dx /= len; dy /= len
        const wa = b.members.length / (a.members.length + b.members.length), wb = 1 - wa
        a.off[0] -= dx * wa * 0.8; a.off[1] -= dy * wa * 0.8
        b.off[0] += dx * wb * 0.8; b.off[1] += dy * wb * 0.8
      }
    }
    if (!moved) break
  }
  // Settle back: every country creeps toward its true position for as long as it can do so without
  // coming within BORDER of another, so neighbours end up where the real borders put them.
  for (let pass = 0; pass < 600; pass++) {
    let moved = false
    for (const a of items) {
      const dist = Math.hypot(a.off[0], a.off[1])
      if (dist < 0.05) continue
      const step = Math.min(0.5, dist)
      const prev = [a.off[0], a.off[1]]
      a.off[0] -= (a.off[0] / dist) * step; a.off[1] -= (a.off[1] / dist) * step
      if (items.some((b) => b !== a && clash(a, b))) { a.off[0] = prev[0]; a.off[1] = prev[1] } else moved = true
    }
    if (!moved) break
  }
  const out = countries.map(() => [0, 0])
  for (const it of items) {
    const [ox, oy] = at(it)
    // Which cells hold startups: a seeded shuffle of the outline's cells, so the shape stays true.
    const cells = it.cells.map(([x, y]) => [x + ox, y + oy])
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]] }
    const pick = cells.slice(0, it.members.length).sort((p, q) => p[0] - q[0] || p[1] - q[1])
    ;[...it.members].sort((p, q) => orderKey(p) - orderKey(q)).forEach((idx, m) => { out[idx] = pick[m] })
    // Pinned startups take the cell nearest their real location; whoever held it swaps places with them.
    for (const idx of it.members) {
      const pin = pins.get(idx)
      if (!pin) continue
      const [px, py] = project(pin)
      const tx = it.bc[0] + (px * it.k - it.bc[0]) * it.s + ox, ty = it.bc[1] + (py * it.k - it.bc[1]) * it.s + oy
      const near = it.members.reduce((best, j) => (Math.hypot(out[j][0] - tx, out[j][1] - ty) < Math.hypot(out[best][0] - tx, out[best][1] - ty) ? j : best), it.members[0])
      ;[out[idx], out[near]] = [out[near], out[idx]]
    }
  }
  return out
}

// Colours neighbouring countries apart: countries whose startups sit within ~10-20 cells of each other are
// "adjacent", and each country takes the first palette colour none of its already-coloured neighbours use
// (biggest countries first). Returns Map country name -> palette index.
export function colorCountries(countries, pos, palette = 10) {
  const B = 10
  const blocks = new Map()
  const count = new Map()
  countries.forEach((c, i) => {
    if (!isEurope(c)) return
    count.set(c, (count.get(c) ?? 0) + 1)
    const key = `${Math.floor(pos[i][0] / B)},${Math.floor(pos[i][1] / B)}`
    if (!blocks.has(key)) blocks.set(key, new Set())
    blocks.get(key).add(c)
  })
  const adj = new Map([...count.keys()].map((c) => [c, new Set()]))
  for (const [key, here] of blocks) {
    const [bx, by] = key.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const a of here) for (const b of blocks.get(`${bx + dx},${by + dy}`) ?? []) if (a !== b) adj.get(a).add(b)
      }
    }
  }
  const out = new Map()
  for (const c of [...count.keys()].sort((a, b) => count.get(b) - count.get(a))) {
    const used = new Map()
    for (const n of adj.get(c)) if (out.has(n)) used.set(out.get(n), (used.get(out.get(n)) ?? 0) + 1)
    let best = 0
    for (let p = 0; p < palette; p++) if ((used.get(p) ?? 0) < (used.get(best) ?? 0)) best = p
    out.set(c, best)
  }
  return out
}
