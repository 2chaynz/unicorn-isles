// Recomputes only the World lens in src/data/world.json (fast; no embeddings or t-SNE).
import { readFileSync, writeFileSync } from 'node:fs'
import { PINS, colorCountries, isEurope, worldLayout } from './world-layout.mjs'

const file = new URL('../src/data/world.json', import.meta.url)
const w = JSON.parse(readFileSync(file, 'utf8'))
let seed = 5
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const pins = new Map(Object.entries(PINS).map(([id, p]) => [w.id.indexOf(id), p]).filter(([i]) => i >= 0))
w.home = w.id.indexOf(Object.keys(PINS)[0])
const pos = worldLayout(w.country.map((c) => w.countries[c] || 'Unknown'), rng, (i) => w.cluster[i] * 1e6 + w.meaning[2 * i] * 1e3 + w.meaning[2 * i + 1], pins)
w.world = pos.flat()
w.europe = w.countries.map(isEurope)
const cc = colorCountries(w.country.map((c) => w.countries[c]), pos)
w.countryColor = w.countries.map((n) => cc.get(n) ?? -1)
// Zero overlap: startups of different countries must keep a clear border between them.
const cell = new Map()
w.id.forEach((_, i) => { if (w.europe[w.country[i]]) cell.set(`${pos[i][0]},${pos[i][1]}`, w.country[i]) })
let tooClose = 0
for (const [k, c] of cell) {
  const [x, y] = k.split(',').map(Number)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const o = cell.get(`${x + dx},${y + dy}`); if (o !== undefined && o !== c) tooClose++ }
}
console.log(`startups of different countries touching or sharing a cell: ${tooClose}`)
console.log(`stacked or off-grid startups: ${w.id.filter((_, i) => w.europe[w.country[i]] && (!Number.isInteger(pos[i][0]) || !Number.isInteger(pos[i][1]))).length}, shared cells: ${w.id.filter((_, i) => w.europe[w.country[i]]).length - cell.size}`)
writeFileSync(file, JSON.stringify(w))
console.log(`world lens: ${w.id.length} startups`)
