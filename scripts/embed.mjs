// Assigns an island to startups imported without a sector (nearest labelled neighbours),
// then writes src/data/positions.json (2D spot per startup inside its island, similar = near)
// and src/data/bridges.json (startups that also belong to another sector, so the map can
// join islands with bridges). Uses Gemini embeddings when GEMINI_API_KEY is set, cached in
// .cache/embeddings.json (also read by the ask endpoint); falls back to TF-IDF otherwise.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

for (const line of existsSync(new URL('../.env', import.meta.url)) ? readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n') : []) {
  const m = line.match(/^(\w+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const KEY = process.env.GEMINI_API_KEY
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIM = 768
// A startup sits between two sectors when the other centroid is nearly as close as its own;
// those startups form the land necks joining islands.
const BRIDGE_MARGIN = 0.02
const MAX_BRIDGES_PER_PAIR = 8
const MAX_PAIRS = 14

const data = (f) => new URL(`../src/data/${f}`, import.meta.url)
const seen = new Set()
const startups = JSON.parse(readFileSync(data('startups.json'), 'utf8')).filter((s) => !seen.has(s.id) && seen.add(s.id))
const summaries = existsSync(data('summaries.json')) ? JSON.parse(readFileSync(data('summaries.json'), 'utf8')) : {}
const CACHE = new URL('../.cache/embeddings.json', import.meta.url)

const text = (s) => `${s.name}. ${s.description}. ${summaries[s.id]?.summary ?? ''}`.trim()
const hash = (t) => createHash('sha1').update(t).digest('hex').slice(0, 12)
const normalise = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n) }

// Retries network errors and rate limits: one dropped request should not lose a whole run.
async function geminiEmbed(texts) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBED_DIM })),
      }),
    }).catch((e) => (attempt < 5 ? null : Promise.reject(e)))
    if (!res || ((res.status === 429 || res.status >= 500) && attempt < 5)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      continue
    }
    const body = await res.json()
    if (!res.ok) throw new Error(`embed: ${res.status} ${body.error?.message}`)
    return body.embeddings.map((e) => normalise(e.values))
  }
}

async function embedAll() {
  if (!KEY) return null
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
  const todo = startups.filter((s) => cache[s.id]?.h !== hash(text(s)))
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100)
    const vecs = await geminiEmbed(batch.map(text))
    batch.forEach((s, k) => { cache[s.id] = { h: hash(text(s)), v: vecs[k].map((x) => Math.round(x * 1e5) / 1e5) } })
    console.log(`embedded ${Math.min(i + 100, todo.length)}/${todo.length}`)
  }
  mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(cache))
  return new Map(startups.map((s) => [s.id, cache[s.id].v]))
}

const STOP = new Set('a an and the of for in on to with by from its is are as at or that this based company startup platform'.split(' '))
const tokens = (s) => s.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []

function tfidf(texts) {
  const docs = texts.map(tokens)
  const df = new Map()
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1)
  const vocab = [...df.keys()].filter((w) => df.get(w) > 1)
  const index = new Map(vocab.map((w, i) => [w, i]))
  return docs.map((d) => {
    const v = new Float64Array(vocab.length)
    for (const w of d) if (index.has(w)) v[index.get(w)] += Math.log(docs.length / df.get(w))
    return normalise([...v])
  })
}

// Top-2 principal components by power iteration; enough to spread neighbours in 2D.
function pca2(vectors) {
  const dim = vectors[0]?.length ?? 0
  if (!dim) return vectors.map(() => [0.5, 0.5])
  const mean = new Float64Array(dim)
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]))
  const comps = []
  for (let c = 0; c < 2; c++) {
    let w = Float64Array.from({ length: dim }, (_, i) => Math.sin(i * 12.9898 + c))
    for (let it = 0; it < 50; it++) {
      const next = new Float64Array(dim)
      for (const x of X) {
        let d = 0
        for (let i = 0; i < dim; i++) d += x[i] * w[i]
        for (let i = 0; i < dim; i++) next[i] += d * x[i]
      }
      for (const prev of comps) {
        let d = 0
        for (let i = 0; i < dim; i++) d += next[i] * prev[i]
        for (let i = 0; i < dim; i++) next[i] -= d * prev[i]
      }
      const n = Math.hypot(...next) || 1
      w = next.map((x) => x / n)
    }
    comps.push(w)
  }
  const proj = X.map((x) => comps.map((w) => x.reduce((a, xi, i) => a + xi * w[i], 0)))
  // Rank-normalise each axis so points fill the island instead of clumping.
  return [0, 1].reduce((acc, axis) => {
    const order = proj.map((p, i) => [p[axis], i]).sort((a, b) => a[0] - b[0])
    order.forEach(([, i], rank) => { acc[i][axis] = order.length > 1 ? rank / (order.length - 1) : 0.5 })
    return acc
  }, proj.map(() => [0.5, 0.5]))
}

const dot = (a, b) => a.reduce((acc, x, i) => acc + x * b[i], 0)

function findBridges(vec) {
  const sectors = [...new Set(startups.map((s) => s.sector))]
  const centroid = new Map(sectors.map((sec) => {
    const members = startups.filter((s) => s.sector === sec).map((s) => vec.get(s.id))
    return [sec, normalise(members[0].map((_, i) => members.reduce((a, v) => a + v[i], 0)))]
  }))
  const candidates = []
  for (const s of startups) {
    const v = vec.get(s.id)
    const own = dot(v, centroid.get(s.sector))
    const [best] = sectors.filter((sec) => sec !== s.sector)
      .map((sec) => ({ sec, gap: dot(v, centroid.get(sec)) - own }))
      .sort((a, b) => b.gap - a.gap)
    if (best.gap > -BRIDGE_MARGIN) candidates.push({ id: s.id, from: s.sector, to: best.sec, gap: best.gap, pair: [s.sector, best.sec].sort().join('|') })
  }
  // Only the most shared island pairs get bridges, plus each island's best pair so none is cut off;
  // otherwise the sea fills with spaghetti.
  const pairs = new Map()
  for (const c of candidates.sort((a, b) => b.gap - a.gap)) pairs.set(c.pair, [...(pairs.get(c.pair) ?? []), c])
  const ranked = [...pairs.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].gap - a[1][0].gap)
  const keep = new Set(ranked.slice(0, MAX_PAIRS).map(([p]) => p))
  for (const sec of sectors) {
    const own = ranked.find(([p]) => p.split('|').includes(sec))
    if (own) keep.add(own[0])
  }
  return [...keep].flatMap((p) => pairs.get(p).slice(0, MAX_BRIDGES_PER_PAIR))
    .map(({ id, to, gap }) => ({ id, to, gap: Math.round(gap * 1e4) / 1e4 }))
}

const gemini = await embedAll()
const fallback = gemini ? null : tfidf(startups.map(text))
const vec = gemini ?? new Map(startups.map((s, i) => [s.id, fallback[i]]))

// Sector by vote of the 15 most similar labelled startups, weighted by similarity.
const labelled = startups.filter((s) => s.sector)
const unlabelled = startups.filter((s) => !s.sector)
if (unlabelled.length && !labelled.length) throw new Error('no startup has a sector to learn from')
for (const s of unlabelled) {
  const v = vec.get(s.id)
  if (!v) throw new Error(`no embedding for ${s.name}`)
  const near = labelled.map((o) => ({ o, sim: dot(v, vec.get(o.id)) })).sort((a, b) => b.sim - a.sim).slice(0, 15)
  const votes = new Map()
  for (const { o, sim } of near) votes.set(o.sector, (votes.get(o.sector) ?? 0) + sim)
  s.sector = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
if (unlabelled.length) {
  writeFileSync(data('startups.json'), JSON.stringify(startups))
  console.log(`assigned sectors to ${unlabelled.length} startups`)
}

const positions = {}
for (const sector of new Set(startups.map((s) => s.sector))) {
  const group = startups.filter((s) => s.sector === sector)
  const xy = pca2(group.map((s) => vec.get(s.id)))
  group.forEach((s, i) => { positions[s.id] = xy[i].map((v) => Math.round(v * 1000) / 1000) })
}
writeFileSync(data('positions.json'), JSON.stringify(positions))
const bridges = findBridges(vec)
writeFileSync(data('bridges.json'), JSON.stringify(bridges))
console.log(`${gemini ? 'gemini' : 'tf-idf'}: positions for ${Object.keys(positions).length}, ${bridges.length} bridges`)
// The layout depends on positions and bridges, so refresh the precomputed one.
await import('./layout.mjs')
