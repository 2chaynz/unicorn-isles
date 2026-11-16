// Cloudflare build step: after `vite build`, writes the data the Pages Functions read into dist/_data/.
// Functions read these through the ASSETS binding; the public URL /_data/* is blocked (functions/_data).
//   _data/index.json        ids and lower-case names, in the same order as the vectors
//   _data/text.bin          bge-small vectors (int8, 384 per startup), copied from src/data/atlas-text.bin
//   _data/s/<id>.json       one startup: full record + summary + provenance (what /api/startup returns)
//   _data/rounds/<id>.json  Cala funding rounds already fetched during the event (.cache/cala-rounds)
//   _data/answers/<h>.json  Cala answers already fetched (.cache/cala-answers), keyed by sha1 of the question
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const at = (p) => new URL(p, root)
const read = (p, fallback) => (existsSync(at(p)) ? JSON.parse(readFileSync(at(p), 'utf8')) : fallback)
const out = (p) => at(`dist/_data/${p}`)
const SAFE = /^[A-Za-z0-9_-]+$/

if (!existsSync(at('dist/index.html'))) throw new Error('run `vite build` first')
for (const d of ['s', 'rounds', 'answers']) mkdirSync(out(d), { recursive: true })

const world = read('src/data/world.json')
const records = read('data/world-startups.json', null) ?? read('src/data/startups.json', [])
const summaries = read('src/data/summaries.json', {})
const prov = read('src/data/prov.json', {})

writeFileSync(out('index.json'), JSON.stringify({ ids: world.id, lower: world.name.map((n) => n.toLowerCase()) }))
copyFileSync(at('src/data/atlas-text.bin'), out('text.bin'))

let n = 0
for (const s of records) {
  if (!SAFE.test(s.id)) { console.warn('skipped unsafe id', s.id); continue }
  writeFileSync(out(`s/${s.id}.json`), JSON.stringify({ ...s, summary: summaries[s.id] ?? null, prov: prov[s.id] ?? null }))
  n++
}

const copyDir = (from, to) => {
  if (!existsSync(at(from))) return 0
  const files = readdirSync(at(from)).filter((f) => f.endsWith('.json') && SAFE.test(f.slice(0, -5)))
  for (const f of files) copyFileSync(at(`${from}/${f}`), out(`${to}/${f}`))
  return files.length
}
const rounds = copyDir('.cache/cala-rounds', 'rounds')
const answers = copyDir('.cache/cala-answers', 'answers')
console.log(`cf-data: ${n} startups, ${rounds} cached rounds, ${answers} cached answers -> dist/_data/`)
