// Builds the Atlas: a t-SNE map of every startup by meaning, auto-named clusters, and a second
// t-SNE of their logos by look (CLIP). All models run locally (transformers.js), no API key.
// Writes src/data/atlas.json, src/data/atlas-text.bin, src/data/atlas-logo.bin, public/atlas-logos.png.
// Resumable: embeddings and logos are cached in .cache/.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { PINS, colorCountries, isEurope, worldLayout } from './world-layout.mjs'
import {
  AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env, pipeline,
} from '@huggingface/transformers'

env.cacheDir = fileURLToPath(new URL('../.cache/models/', import.meta.url))
export const TEXT_MODEL = 'Xenova/bge-small-en-v1.5'
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32'
const CELL = 64
const SPRITE_COLS = 128
const INNER = Math.round(64 * 0.72)
const PAD = Math.floor((64 - INNER) / 2)
// Exact t-SNE runs on this many startups; the rest are placed among their nearest sampled neighbours.
const SAMPLE = 6000
const CLUSTERS = 22

const root = (p) => new URL(`../${p}`, import.meta.url)
const readJson = (p, fb) => (existsSync(root(p)) ? JSON.parse(readFileSync(root(p), 'utf8')) : fb)
mkdirSync(root('.cache/logos'), { recursive: true })

const seen = new Set()
// Nordic + Baltic set first (it has Gemini summaries), then the worldwide Cala import if present.
const unique = [...readJson('src/data/startups.json', []), ...readJson('.cache/world-startups.json', [])]
  .filter((s) => !seen.has(s.id) && seen.add(s.id))

// Some records carry a two-letter code ("ES") instead of a country name.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
for (const s of unique) {
  if (typeof s.country === 'string' && /^[A-Z]{2}$/.test(s.country)) { try { s.country = regionNames.of(s.country) ?? s.country } catch { /* keep */ } }
}

// The same company arrives under several ids ("Anthropic", "Anthropic PBC", "Anthropic, PBC"):
// records sharing a website domain or a normalised name are merged, keeping the richest record
// and the union of investors and rounds.
const LEGAL = /\b(pbc|inc|llc|ltd|limited|corp|corporation|gmbh|oy|ab|as|aps|ag|bv|sa|sas|plc|co|company|holdings?|group)\b\.?/g
const nameKey = (n) => (n ?? '').toLowerCase().replace(LEGAL, '').replace(/[^a-z0-9]/g, '')
const domKey = (w) => (w ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
const richness = (s) => (s.totalFunding ? 4 : 0) + (s.rounds?.length ? 2 : 0) + (s.description ? 1 : 0) + (s.founded ? 1 : 0)
  + (s.country && s.country !== 'Unknown' ? 1 : 0) + (s.website ? 1 : 0) + (s.id.startsWith('q-') ? -3 : 0)
// Gaps (HQ, site, one-liner, founding year) that Gemma filled in scripts/enrich-gemma.mjs.
const overrides = readJson('.cache/enrich-overrides.json', {})
for (const s of unique) {
  const o = overrides[s.id]
  if (!o) continue
  for (const k of ['country', 'website', 'description', 'founded']) if ((!s[k] || s[k] === 'Unknown') && o[k]) s[k] = o[k]
  s.gemma = true
}
// Valuations (Cala first, Gemma's recollection for famous names) and company maturity.
const valuations = readJson('.cache/valuations.json', {})
const maturityG = readJson('.cache/enrich-maturity.json', {})
// Companies Cala knows a valuation for that the portfolio crawl never found (mostly established giants
// and unicorns) join the map as new entries, with only what Cala's answer gave: name, country, sector.
const COUNTRY = { UK: 'United Kingdom', USA: 'United States', US: 'United States', 'U.S.': 'United States', 'The Netherlands': 'Netherlands', Czechia: 'Czechia', 'Hong Kong': 'Hong Kong', UAE: 'United Arab Emirates', 'South Korea': 'South Korea' }
const country = (c) => {
  const first = String(c ?? '').split(/[(,/]/)[0].trim()
  return first ? COUNTRY[first] ?? first : null
}
const known = new Set(unique.map((s) => nameKey(s.name)))
for (const [k, v] of Object.entries(valuations)) {
  if (known.has(k)) continue
  known.add(k)
  unique.push({
    id: `v-${k}`, name: v.name, sector: null, country: country(v.country), founded: overrides[`v-${k}`]?.founded ?? null, website: overrides[`v-${k}`]?.website ?? null,
    description: v.sector ? `${v.sector} company.` : '', hq: null, fundingStage: null, totalFunding: null, headcount: null, status: null, slush: false,
    rounds: [], investors: [], founders: [], ceo: [], world: true, fromValuation: true,
    maturityG: /established companies/.test(v.query) ? 'established' : undefined,
  })
}
const usd = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(1)}B` : `${Math.round(m)}M`)
for (const s of unique) {
  const v = valuations[nameKey(s.name)]
  if (v) s.valuation = { eur: v.eur, text: v.text, src: 'cala' }
  const m = maturityG[s.id]
  if (!m) continue
  if (m.status) s.status = m.status
  if (m.maturity) s.maturityG = m.maturity
  if (m.public !== undefined) s.public = m.public
  if (m.employees) s.employees = m.employees
  if (!s.valuation && m.valuation_usd_m) s.valuation = { eur: Math.round(m.valuation_usd_m * 1e6 * 0.92), text: `≈ ${usd(m.valuation_usd_m)}`, src: 'gemma' }
}
const parent = unique.map((_, i) => i)
const root_ = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
const firstWith = new Map()
unique.forEach((s, i) => {
  for (const k of [domKey(s.website) && `d:${domKey(s.website)}`, nameKey(s.name).length > 2 && `n:${nameKey(s.name)}`]) {
    if (!k) continue
    if (firstWith.has(k)) parent[root_(i)] = root_(firstWith.get(k))
    else firstWith.set(k, i)
  }
})
const clusters_ = new Map()
unique.forEach((s, i) => clusters_.set(root_(i), [...(clusters_.get(root_(i)) ?? []), s]))
const everyone = [...clusters_.values()].map((members) => {
  const best = [...members].sort((a, b) => richness(b) - richness(a))[0]
  const merged = { ...best }
  for (const m of members) {
    for (const k of ['country', 'website', 'description', 'hq', 'founded', 'fundingStage', 'headcount']) if (!merged[k] || merged[k] === 'Unknown') merged[k] = m[k] ?? merged[k]
    if (!merged.totalFunding && m.totalFunding) merged.totalFunding = m.totalFunding
    merged.slush ||= m.slush
  }
  merged.investors = [...new Map(members.flatMap((m) => m.investors ?? []).map((i) => [i.id, i])).values()]
  merged.rounds = [...new Map(members.flatMap((m) => m.rounds ?? []).map((r) => [r.id, r])).values()]
  merged.alias = members.map((m) => m.id).filter((id) => id !== merged.id)
  const srcRank = (v) => (v?.src === 'cala' ? 2 : v?.src === 'gemma' ? 1 : 0)
  merged.valuation = members.map((m) => m.valuation).filter(Boolean).sort((a, b) => srcRank(b) - srcRank(a) || b.eur - a.eur)[0] ?? null
  for (const k of ['status', 'maturityG', 'public', 'employees']) merged[k] = merged[k] ?? members.find((m) => m[k] !== undefined)?.[k]
  return merged
})
// Only startups belong on the map: acquired subsidiaries (Instagram), listed companies and long-established
// firms are dropped. Gemma's "startup" verdict keeps big independent private companies (Stripe) in.
// The map is for young startups: a company founded before this year is out, whatever it has become.
// Companies with no known founding year stay, since nothing says they are old.
const FOUNDED_FROM = 2020
const acquired = readJson('.cache/acquired.json', {})
const notStartup = (s) => {
  if (s.founded && s.founded < FOUNDED_FROM) return true
  // Cala lists it among a bigger company's acquisitions. Very short names collide with ordinary words
  // ("Mate", "Karma"), so for those Gemma's "still independent" verdict wins.
  if (acquired[nameKey(s.name)]) return !(nameKey(s.name).length <= 5 && s.status === 'startup')
  if (s.status === 'startup') return false
  const age = s.founded ? 2026 - s.founded : null
  return ['acquired', 'established'].includes(s.status) || s.public === true || s.maturityG === 'established' || (age !== null && age >= 18) || (s.employees ?? 0) >= 1000
}
// Nearly empty records (a bare name, often from a Y Combinator list) only clutter the map. A record scores a point
// each for a real description, a website, a known country, a founding year, funding or a valuation, and some
// backing; fewer than two points means it is dropped, unless it has a valuation (or is Cala itself).
const thin = (s) => {
  if (s.valuation || s.name === 'Cala AI') return false
  const score = ((s.description ?? '').length >= 60) + !!s.website + !!(s.country && s.country !== 'Unknown') + !!s.founded
    + !!(s.totalFunding || s.valuation) + ((s.investors?.length ?? 0) >= 2 || (s.rounds?.length ?? 0) >= 1)
  return score < 2
}
const startups = everyone.filter((s) => !notStartup(s) && !thin(s))
writeFileSync(root('.cache/dropped.json'), JSON.stringify(everyone.filter(notStartup).map((s) => ({ name: s.name, status: s.status, founded: s.founded, public: s.public, employees: s.employees }))))
console.log(`merged ${unique.length} records into ${everyone.length}; dropped ${everyone.length - startups.length} (not startups, or too thin); ${startups.length} remain`)
const summaries = readJson('src/data/summaries.json', {})
const N = startups.length
// What a company does, without the summaries' funding and "why investors care" sentences, which
// read alike for every company and would pull the whole map into one blob.
const about = (s) => (summaries[s.id]?.summary ?? '').split(/(?<=[.!?])\s+/)
  .filter((x) => !/investor|compelling|raised|funding|series [a-e]|led by|valuation|backed/i.test(x)).join(' ')
// Cala descriptions often open with "Finnish fintech company founded in 2021 and headquartered in
// Helsinki": nationality, year and city would cluster startups by country, not by what they do.
const NATION = /\b(american|british|english|german|french|spanish|italian|dutch|belgian|swiss|austrian|polish|czech|portuguese|irish|finnish|swedish|norwegian|danish|estonian|latvian|lithuanian|icelandic|israeli|indian|chinese|japanese|korean|canadian|australian|singaporean|brazilian|mexican|turkish|ukrainian|romanian|hungarian|greek|bulgarian|croatian|slovenian|slovak|serbian|luxembourgish|emirati|saudi|nigerian|kenyan|egyptian|south african|argentinian|chilean|colombian)\b/gi
const clean = (d) => (d ?? '').replace(NATION, '')
  .replace(/,?\s*(founded|established|incorporated|launched) in \d{4}/gi, '')
  .replace(/,?\s*(and )?(headquartered|based|located) in [A-Z][\w-]+(,? [A-Z][\w-]+)*/g, '')
  .replace(/\s{2,}/g, ' ').trim()
const text = (s) => `${s.name}. ${clean(s.description)} ${about(s)}`.trim()
const sha = (t) => createHash('sha1').update(t).digest('hex').slice(0, 12)
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n) }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- text embeddings ----------
async function embedTexts() {
  const cachePath = '.cache/atlas-text.json'
  const cache = readJson(cachePath, {})
  const todo = startups.filter((s) => cache[s.id]?.h !== sha(text(s)))
  if (todo.length) {
    const ext = await pipeline('feature-extraction', TEXT_MODEL, { dtype: 'q8' })
    for (let i = 0; i < todo.length; i += 32) {
      const batch = todo.slice(i, i + 32)
      const out = await ext(batch.map(text), { pooling: 'cls', normalize: true })
      const d = out.dims[1]
      batch.forEach((s, k) => { cache[s.id] = { h: sha(text(s)), v: Array.from(out.data.slice(k * d, (k + 1) * d), (x) => Math.round(x * 1e4) / 1e4) } })
      if (i % 640 === 0) { log(`text ${i + batch.length}/${todo.length}`); writeFileSync(root(cachePath), JSON.stringify(cache)) }
    }
    writeFileSync(root(cachePath), JSON.stringify(cache))
  }
  return startups.map((s) => norm(cache[s.id].v))
}

// ---------- logos ----------
const domainOf = (w) => w?.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase() || null

async function fetchLogo(domain) {
  const file = root(`.cache/logos/${domain}.png`)
  const miss = root(`.cache/logos/${domain}.miss`)
  if (existsSync(file)) return readFileSync(file)
  if (existsSync(miss)) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=256`, { signal: AbortSignal.timeout(15000) })
      // 404 = Google's default globe: the site has no icon.
      if (res.status === 404) { writeFileSync(miss, ''); return null }
      if (!res.ok) throw new Error(String(res.status))
      const buf = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(buf).metadata()
      // Tiny favicons upscale into mush; not worth a place on the visual map.
      if ((meta.width ?? 0) < 32) { writeFileSync(miss, ''); return null }
      const png = await sharp(buf).png().toBuffer()
      writeFileSync(file, png)
      return png
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  return null
}

async function loadLogos() {
  const domains = [...new Set(startups.map((s) => domainOf(s.website)).filter(Boolean))]
  const got = new Map()
  let done = 0
  const queue = [...domains]
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let d; (d = queue.shift());) {
      const buf = await fetchLogo(d)
      if (buf) got.set(d, buf)
      if (++done % 500 === 0) log(`logos ${done}/${domains.length}, ${got.size} usable`)
    }
  }))
  // The same icon on many sites is a site builder's default, not the company's logo.
  const byHash = new Map()
  for (const [d, buf] of got) { const h = sha(buf.toString('base64')); byHash.set(h, [...(byHash.get(h) ?? []), d]) }
  for (const ds of byHash.values()) if (ds.length >= 3) ds.forEach((d) => got.delete(d))
  return got
}

async function embedLogos(logos, members) {
  const cachePath = '.cache/atlas-logo.json'
  const cache = readJson(cachePath, {})
  const todo = members.filter((i) => !cache[domainOf(startups[i].website)])
  if (todo.length) {
    const processor = await AutoProcessor.from_pretrained(CLIP_MODEL)
    const vision = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: 'q8' })
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16)
      const images = await Promise.all(batch.map(async (j) => {
        const { data, info } = await sharp(logos.get(domainOf(startups[j].website)))
          .flatten({ background: '#ffffff' }).resize(224, 224, { fit: 'contain', background: '#ffffff' })
          .removeAlpha().raw().toBuffer({ resolveWithObject: true })
        return new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3)
      }))
      const { image_embeds } = await vision(await processor(images))
      const d = image_embeds.dims[1]
      batch.forEach((j, k) => { cache[domainOf(startups[j].website)] = Array.from(image_embeds.data.slice(k * d, (k + 1) * d), (x) => Math.round(x * 1e4) / 1e4) })
      if (i % 320 === 0) { log(`clip ${i + batch.length}/${todo.length}`); writeFileSync(root(cachePath), JSON.stringify(cache)) }
    }
    writeFileSync(root(cachePath), JSON.stringify(cache))
  }
  return members.map((i) => norm(cache[domainOf(startups[i].website)]))
}

// ---------- maths ----------
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

// Seeded so the map is the same on every run.
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } }

// t-SNE with sparse kNN affinities and exact repulsion: fine for a few thousand points.
function tsne(neigh, { perplexity = 30, iters = 900, seed = 7 } = {}) {
  const n = neigh.length
  const P = new Map()
  for (let i = 0; i < n; i++) {
    const d = neigh[i].map(([, s]) => 1 - s)
    let lo = 1e-6, hi = 1e6, beta = 1, w = []
    for (let t = 0; t < 60; t++) {
      w = d.map((x) => Math.exp(-x * beta))
      const sum = w.reduce((a, b) => a + b, 0) || 1e-12
      const H = Math.log(sum) + beta * d.reduce((a, x, k) => a + x * w[k], 0) / sum
      if (Math.abs(H - Math.log(perplexity)) < 1e-4) break
      if (H > Math.log(perplexity)) { lo = beta; beta = hi === 1e6 ? beta * 2 : (beta + hi) / 2 } else { hi = beta; beta = (beta + lo) / 2 }
    }
    const sum = w.reduce((a, b) => a + b, 0) || 1e-12
    neigh[i].forEach(([j], k) => {
      const key = i < j ? i * n + j : j * n + i
      P.set(key, (P.get(key) ?? 0) + w[k] / sum)
    })
  }
  const pairs = [...P].map(([key, p]) => [Math.floor(key / n), key % n, p / (2 * n)])
  const r = rng(seed)
  const Y = new Float64Array(n * 2).map(() => (r() - 0.5) * 1e-2)
  const V = new Float64Array(n * 2)
  const G = new Float64Array(n * 2)
  const gains = new Float64Array(n * 2).fill(1)
  const lr = Math.max(200, n / 12)
  for (let it = 0; it < iters; it++) {
    const exag = it < 250 ? 12 : 1
    G.fill(0)
    let Z = 0
    for (let i = 0; i < n; i++) {
      const xi = Y[2 * i], yi = Y[2 * i + 1]
      for (let j = i + 1; j < n; j++) {
        const dx = xi - Y[2 * j], dy = yi - Y[2 * j + 1]
        const q = 1 / (1 + dx * dx + dy * dy)
        Z += 2 * q
        const q2 = q * q
        G[2 * i] -= q2 * dx; G[2 * i + 1] -= q2 * dy
        G[2 * j] += q2 * dx; G[2 * j + 1] += q2 * dy
      }
    }
    for (let k = 0; k < G.length; k++) G[k] /= Z
    for (const [i, j, p] of pairs) {
      const dx = Y[2 * i] - Y[2 * j], dy = Y[2 * i + 1] - Y[2 * j + 1]
      const f = exag * p / (1 + dx * dx + dy * dy)
      G[2 * i] += f * dx; G[2 * i + 1] += f * dy
      G[2 * j] -= f * dx; G[2 * j + 1] -= f * dy
    }
    const mom = it < 250 ? 0.5 : 0.8
    for (let k = 0; k < Y.length; k++) {
      const g = 4 * G[k]
      gains[k] = Math.sign(g) === Math.sign(V[k]) ? gains[k] * 0.8 : gains[k] + 0.2
      gains[k] = Math.max(gains[k], 0.01)
      V[k] = mom * V[k] - lr * gains[k] * g
      Y[k] += V[k]
    }
    if (it % 100 === 0) log(`t-sne ${it}/${iters}`)
  }
  return Array.from({ length: n }, (_, i) => [Y[2 * i], Y[2 * i + 1]])
}

// Every startup gets its own square on an integer grid, as close as possible to its t-SNE spot.
function snap(xy, fill = 0.55) {
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
  const scale = Math.sqrt(xy.length / fill / (w * h))
  const taken = new Set()
  const order = xy.map((_, i) => i).sort((a, b) => Math.hypot(xy[a][0] - x0 - w / 2, xy[a][1] - y0 - h / 2) - Math.hypot(xy[b][0] - x0 - w / 2, xy[b][1] - y0 - h / 2))
  const out = new Array(xy.length)
  const cx = (w * scale) / 2, cy = (h * scale) / 2
  for (const i of order) {
    const tx = (xy[i][0] - x0) * scale - cx, ty = (xy[i][1] - y0) * scale - cy
    let best = null
    for (let rad = 0; !best; rad++) {
      for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue
        const gx = Math.round(tx) + dx, gy = Math.round(ty) + dy
        if (taken.has(`${gx},${gy}`)) continue
        const d = Math.hypot(gx - tx, gy - ty)
        if (!best || d < best[2]) best = [gx, gy, d]
      }
    }
    taken.add(`${best[0]},${best[1]}`)
    out[i] = [best[0], best[1]]
  }
  return out
}

// k-means on the embeddings (cosine): themes follow meaning, so neighbouring themes blend at their
// edges on the map instead of meeting at hard borders.
function kmeansVec(vecs, k, seed = 3) {
  const r = rng(seed)
  const n = vecs.length, d = vecs[0].length
  const dotv = (a, b) => { let s = 0; for (let t = 0; t < d; t++) s += a[t] * b[t]; return s }
  let cents = Array.from({ length: k }, () => vecs[Math.floor(r() * n)])
  let assign = new Int32Array(n)
  for (let it = 0; it < 30; it++) {
    const next = Int32Array.from(vecs, (v) => { let b = 0, bs = -9; for (let j = 0; j < k; j++) { const s = dotv(v, cents[j]); if (s > bs) { bs = s; b = j } } return b })
    const sums = Array.from({ length: k }, () => new Float32Array(d))
    next.forEach((c, i) => { const v = vecs[i], acc = sums[c]; for (let t = 0; t < d; t++) acc[t] += v[t] })
    cents = sums.map((acc, j) => (acc.some((x) => x) ? norm(acc) : vecs[Math.floor(r() * n)]))
    const changed = next.some((c, i) => c !== assign[i])
    assign = next
    if (!changed) break
  }
  return assign
}



// c-TF-IDF: words that are frequent in one cluster and rare in the others name it.
const STOP = new Set(`a an and the of for in on to with by from its it is are as at or that this be has have was were which their they them our your we
  company companies startup startups platform platforms based founded headquartered provides offers develops building builds solution solutions
  investors may find compelling raised million funding round led series seed pre also helps help using use uses its into through across new more
  finnish swedish norwegian danish estonian latvian lithuanian icelandic nordic baltic finland sweden norway denmark estonia latvia lithuania iceland
  helsinki stockholm oslo copenhagen tallinn riga vilnius espoo tampere turku gothenburg malmo aarhus oy ab ltd inc limited as aps uab sia
  because its while such other than both well within over based global world european europe users customers businesses market technology services
  tech digital data software solution product products system systems way make making allows enable enables enabling capital ventures fund vc
  care sells sell selling traction teams team including value details disclosed publicly not regarding backed commercial operates operating
  focused focuses focus offering offer specializes specialized specialising specializing designed develop developing development provider
  company's startup's investors' strong growing growth early stage potential scalable recurring revenue model business unlike compared`.split(/\s+/))
const words = (t) => (t.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w))

function labelClusters(assign, k) {
  const tf = Array.from({ length: k }, () => new Map())
  const df = new Map()
  startups.forEach((s, i) => {
    const ws = words(`${s.description ?? ''} ${summaries[s.id]?.summary ?? ''}`)
    for (const w of new Set(ws)) tf[assign[i]].set(w, (tf[assign[i]].get(w) ?? 0) + 1)
  })
  tf.forEach((m) => m.forEach((_, w) => df.set(w, (df.get(w) ?? 0) + 1)))
  // Words used in most themes (summary boilerplate like "care" or "traction") name none of them.
  const used = new Set()
  return tf.map((m, c) => {
    const size = [...assign].filter((x) => x === c).length || 1
    const ranked = [...m].filter(([w, n]) => n >= 3 && df.get(w) <= k * 0.4)
      .map(([w, n]) => [w, (n / size) * Math.log(k / df.get(w))])
      .sort((a, b) => b[1] - a[1]).map(([w]) => w)
    // Drop near-duplicates ("game", "games") so the top terms say different things.
    const terms = []
    for (const w of ranked) if (terms.length < 6 && !terms.some((t) => t.slice(0, 5) === w.slice(0, 5))) terms.push(w)
    // Two themes must not share a name.
    const first = terms.find((t) => !used.has(t)) ?? terms[0]
    const second = terms.find((t) => t !== first && !used.has(`${first}|${t}`)) ?? terms[1]
    used.add(first).add(`${first}|${second}`)
    return [first, second, ...terms.filter((t) => t !== first && t !== second)].filter(Boolean)
  })
}

function toI8(vecs) {
  const d = vecs[0]?.length ?? 0
  const out = new Int8Array(vecs.length * d)
  vecs.forEach((v, i) => { for (let k = 0; k < d; k++) out[i * d + k] = Math.max(-127, Math.min(127, Math.round(v[k] * 127))) })
  return out
}

// Top-k by cosine of each query against a candidate set; flat Float32 loops so 40k x 6k stays quick.
function topK(queries, cands, k, skipSelf = false) {
  const d = queries[0].length
  const C = new Float32Array(cands.length * d)
  cands.forEach((v, i) => C.set(v, i * d))
  return queries.map((q, qi) => {
    const best = []
    for (let j = 0; j < cands.length; j++) {
      if (skipSelf && j === qi) continue
      let s = 0
      for (let t = 0, o = j * d; t < d; t++) s += q[t] * C[o + t]
      if (best.length < k) {
        best.push([j, s])
        if (best.length === k) best.sort((a, b) => b[1] - a[1])
      } else if (s > best[k - 1][1]) {
        let p = k - 1
        while (p > 0 && best[p - 1][1] < s) { best[p] = best[p - 1]; p-- }
        best[p] = [j, s]
      }
    }
    return best.sort((a, b) => b[1] - a[1])
  })
}

// t-SNE on a seeded sample, then everyone else lands at the similarity-weighted mean of their
// 5 nearest sampled neighbours (plus a little jitter so twins do not stack).
function layout(vecs, { perplexity = 30, seed = 11 } = {}) {
  const r = rng(seed)
  const n = vecs.length
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
  const sample = idx.slice(0, Math.min(SAMPLE, n)).sort((a, b) => a - b)
  const inSample = new Map(sample.map((i, k) => [i, k]))
  const sv = sample.map((i) => vecs[i])
  const neigh = topK(sv, sv, Math.min(90, sv.length - 1), true)
  log(`knn on sample of ${sv.length} ready`)
  const Y = tsne(neigh, { perplexity })
  const xy = new Array(n)
  sample.forEach((i, k) => { xy[i] = Y[k] })
  const rest = idx.filter((i) => !inSample.has(i))
  const spread = Math.sqrt(Y.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / Y.length) * 0.01
  if (rest.length) {
    topK(rest.map((i) => vecs[i]), sv, 5).forEach((nb, k) => {
      const w = nb.map(([, s]) => Math.exp(12 * s))
      const tw = w.reduce((a, b) => a + b, 0)
      xy[rest[k]] = [0, 1].map((a) => nb.reduce((acc, [j], t) => acc + Y[j][a] * w[t], 0) / tw + (r() - 0.5) * spread)
    })
  }
  return xy
}


// Gemma reads each theme's top words and a sample of its companies and names it in 1-3 words.
// Cached by content, so reruns cost nothing; falls back to the top words without a key.
async function nameThemes(terms, assign) {
  const key = process.env.GEMINI_API_KEY ?? (existsSync(root('.env')) ? readFileSync(root('.env'), 'utf8').match(/GEMINI_API_KEY=(\S+)/)?.[1] : null)
  if (!key) return []
  const groups = terms.map((t, c) => {
    const members = startups.filter((_, i) => assign[i] === c).slice(0, 14)
    return { theme: c, words: t, companies: members.map((s) => `${s.name}: ${clean(s.description).slice(0, 90)}`) }
  })
  const cachePath = `.cache/theme-names-${sha(JSON.stringify(groups))}.json`
  const cached = readJson(cachePath, null)
  if (cached) return cached
  const prompt = `Each group below is a cluster of startups. Name every group with a short, specific market name of 1-3 words in Title Case (e.g. "Payments", "Mental Health", "Battery Tech", "Game Studios"). Names must all be different.
Reply with JSON only: an array of strings in group order, nothing else.

${JSON.stringify(groups)}`
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = attempt % 2 ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it'
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt))
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: 'minimal' } } }),
        signal: AbortSignal.timeout(120000),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${out.error?.message ?? ''}`)
      const text = (out.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
      const names = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
      if (Array.isArray(names) && names.length === terms.length) {
        writeFileSync(root(cachePath), JSON.stringify(names))
        log(`themes named by ${model}`)
        return names
      }
    } catch (e) {
      log(`theme naming failed (${model}): ${e.message}`)
    }
  }
  return []
}

// A logo whose corners are opaque (a favicon with a solid square background) fills the circle and the mask
// trims its corners; one with transparent corners sits inside the circle with a margin.
async function roundLogo(buf) {
  const corner = await sharp(buf).ensureAlpha().resize(8, 8, { fit: 'fill' }).raw().toBuffer()
  const opaque = [3, 4 * 7 + 3, 4 * 56 + 3, 4 * 63 + 3].every((p) => corner[p] > 200)
  if (opaque) return sharp(buf).resize(CELL, CELL, { fit: 'cover' }).png().toBuffer()
  return sharp(buf).resize(INNER, INNER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: PAD, bottom: CELL - INNER - PAD, left: PAD, right: CELL - INNER - PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
}

// ---------- run ----------
log(`${N} startups`)
const textVecs = await embedTexts()
log('text embeddings ready')
const logos = await loadLogos()
const logoMembers = startups.map((s, i) => (logos.has(domainOf(s.website)) ? i : -1)).filter((i) => i >= 0)
log(`${logoMembers.length} usable logos`)
const logoVecs = await embedLogos(logos, logoMembers)
log('logo embeddings ready')

// Moderately loose grid: one cloud where related groups touch and unrelated ones keep some sea between.
const textXY = snap(layout(textVecs), 0.4)
const assign = kmeansVec(textVecs, CLUSTERS)
const terms = labelClusters(assign, CLUSTERS)
const names = await nameThemes(terms, assign)
// Soft membership: a startup sits between its two closest themes when they score nearly the same,
// and the map blends their colours.
const centroids = Array.from({ length: CLUSTERS }, (_, c) => {
  const acc = new Float32Array(textVecs[0].length)
  textVecs.forEach((v, i) => { if (assign[i] === c) for (let t = 0; t < acc.length; t++) acc[t] += v[t] })
  return norm(acc)
})
const cluster2 = new Array(N).fill(0), mix = new Array(N).fill(0)
textVecs.forEach((v, i) => {
  const sims = centroids.map((c) => { let d = 0; for (let t = 0; t < v.length; t++) d += v[t] * c[t]; return d })
  const order = sims.map((_, c) => c).sort((a, b) => sims[b] - sims[a])
  const [a, b] = order[0] === assign[i] ? [order[0], order[1]] : [assign[i], order[0]]
  const pa = Math.exp(sims[a] / 0.025), pb = Math.exp(sims[b] / 0.025)
  cluster2[i] = b
  mix[i] = Math.round((pb / (pa + pb)) * 100)
})
const clusters = terms.map((t, c) => {
  const pts = textXY.filter((_, i) => assign[i] === c)
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
  return { label: names[c] ?? t.slice(0, 2).join(' & '), terms: t, x: med(pts.map((p) => p[0])), y: med(pts.map((p) => p[1])), size: pts.length }
})
log('themes ready')
const logoXY = snap(layout(logoVecs, { perplexity: 20 }), 0.3)

// Sprite sheet in logo order; deck.gl reads one texture instead of thousands of images.
const rows = Math.ceil(logoMembers.length / SPRITE_COLS)
const tiles = []
for (let k = 0; k < logoMembers.length; k++) {
  tiles.push({
    // The logo sits inside the circle with a margin, so the round mask never cuts into it.
    input: await roundLogo(logos.get(domainOf(startups[logoMembers[k]].website))),
    left: (k % SPRITE_COLS) * CELL, top: Math.floor(k / SPRITE_COLS) * CELL,
  })
}
await sharp({ create: { width: SPRITE_COLS * CELL, height: Math.max(1, rows) * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles).png({ compressionLevel: 9 }).toFile(fileURLToPath(root('.cache/atlas-logos.png')))

// Columnar and compact: the page loads every startup's position and facets, details come per startup.
const RATES = {
  EUR: 1, USD: 0.92, GBP: 1.17, SEK: 0.087, NOK: 0.085, DKK: 0.134, ISK: 0.0066, CHF: 1.05, PLN: 0.23, CZK: 0.04, KRW: 0.00066,
  JPY: 0.0061, CAD: 0.67, SGD: 0.69, INR: 0.011, TRY: 0.027, BRL: 0.17, AED: 0.25, BGN: 0.51, PHP: 0.016, IDR: 0.000058,
  AUD: 0.6, CNY: 0.13, HKD: 0.12, ILS: 0.25,
}
const STAGES = ['Unknown', 'Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+']
const stageOf = (s) => {
  const f = s.fundingStage ?? ''
  if (f === 'PRE_SEED') return 1
  if (f === 'SEED') return 2
  if (f === 'SERIES_A') return 3
  if (f === 'SERIES_B') return 4
  return /^SERIES_[C-Z]/.test(f) ? 5 : 0
}
const facet = (vals) => {
  const list = [...new Set(vals)].sort()
  const at = new Map(list.map((v, i) => [v, i]))
  return [list, vals.map((v) => at.get(v))]
}
const [sectors, sectorIdx] = facet(startups.map((s) => s.sector ?? 'other'))
const [countries, countryIdx] = facet(startups.map((s) => s.country ?? 'Unknown'))
const logoAt = new Map(logoMembers.map((i, k) => [i, k]))
// Size value (EUR) and how mature a company is. Without a valuation the size falls back to a multiple
// of the money raised, flagged as an estimate (valueSrc 3) so the page never passes it off as sourced.
const raisedEur = (s) => Math.round((s.totalFunding?.value ?? 0) * (RATES[s.totalFunding?.units] ?? 0))
const derived = startups.map((s) => {
  const raised = raisedEur(s)
  let value = 0, src = 0
  if (s.valuation) { value = s.valuation.eur; src = s.valuation.src === 'cala' ? 1 : 2 }
  else if (raised) { value = raised * 4; src = 3 }
  const age = s.founded ? 2026 - s.founded : null
  const st = stageOf(s)
  let maturity = 0 // 0 unknown, 1 early, 2 startup, 3 scale-up, 4 established
  if (s.maturityG === 'established' || s.public === true || (age !== null && age >= 18) || (s.employees ?? 0) >= 1000) maturity = 4
  else if (s.maturityG === 'scaleup' || (src && src < 3 && value >= 3e8) || st === 5 || (age !== null && age >= 11)) maturity = 3
  else if ((age !== null && age <= 3) || ((st === 1 || st === 2) && (age === null || age <= 6))) maturity = 1
  else if (s.maturityG === 'startup' || s.founded || raised) maturity = 2
  return { value, src, maturity }
})
const pinned = new Map(Object.entries(PINS).map(([id, p]) => [startups.findIndex((s) => s.id === id || s.alias?.includes(id)), p]).filter(([i]) => i >= 0))
const worldShape = worldLayout(startups.map((s) => s.country || 'Unknown'), rng(5), (i) => assign[i] * 1e6 + textXY[i][0] * 1e3 + textXY[i][1], pinned)
const europeColours = colorCountries(startups.map((s) => s.country || 'Unknown'), worldShape)
writeFileSync(root('src/data/atlas-text.bin'), toI8(textVecs))
writeFileSync(root('src/data/atlas-logo.bin'), toI8(logoVecs))
writeFileSync(root('src/data/world.json'), JSON.stringify({
  models: { text: TEXT_MODEL, logo: CLIP_MODEL },
  sectors, countries, stages: STAGES,
  id: startups.map((s) => s.id),
  name: startups.map((s) => s.name),
  sector: sectorIdx,
  country: countryIdx,
  founded: startups.map((s) => s.founded ?? 0),
  raised: startups.map((s) => Math.round((s.totalFunding?.value ?? 0) * (RATES[s.totalFunding?.units] ?? 0))),
  stage: startups.map(stageOf),
  value: derived.map((d) => d.value),
  valueSrc: derived.map((d) => d.src),
  maturity: derived.map((d) => d.maturity),
  employees: startups.map((s) => s.employees ?? 0),
  investors: startups.map((s) => s.investors?.length ?? 0),
  slush: startups.map((s) => (s.slush ? 1 : 0)),
  cluster: [...assign],
  cluster2,
  mix,
  logo: startups.map((_, i) => logoAt.get(i) ?? -1),
  meaning: textXY.flat(),
  look: logoXY.flat(),
  world: worldShape.flat(),
  europe: countries.map(isEurope),
  home: [...pinned.keys()][0] ?? -1,
  countryColor: countries.map((n) => europeColours.get(n) ?? -1),
  clusters,
  sprite: { url: 'atlas-logos.png', cols: SPRITE_COLS, cell: CELL, width: SPRITE_COLS * CELL, height: Math.max(1, rows) * CELL },
}))
// Full records for the server (details, rounds, search); the page never imports this file.
mkdirSync(root('data'), { recursive: true })
writeFileSync(root('data/world-startups.json'), JSON.stringify(startups))
log('wrote src/data/world.json')
await (await import('./ink-logos.mjs')).inkLogos()
