// Fills gaps Cala's bulk graph leaves (HQ country, website, what they do, founding year) with Gemma.
// It must answer null when unsure; anything it fills is flagged `gemma` in the data, and the page
// shows the first letter of the name where nothing could be found.
// Reads the merged list from data/world-startups.json (written by scripts/atlas.mjs) and writes
// .cache/enrich-overrides.json, which atlas.mjs applies on its next run. Cached per batch; rerun to resume.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/GEMINI_API_KEY=(\S+)/)[1]
const SRC = new URL('../data/world-startups.json', import.meta.url)
const OUT = new URL('../.cache/enrich-overrides.json', import.meta.url)
const DIR = new URL('../.cache/enrich2/', import.meta.url)
const BATCH = 50
const PARALLEL = 3
mkdirSync(DIR, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const all = JSON.parse(readFileSync(SRC, 'utf8'))
const overrides = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const gaps = (s) => ['country', 'website', 'description', 'founded'].filter((k) => !s[k] || s[k] === 'Unknown')
const todo = all.filter((s) => gaps(s).length && !(s.id in overrides))
log(`${todo.length} of ${all.length} startups have gaps`)

async function gemma(prompt) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = attempt % 2 ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it'
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, thinkingConfig: { thinkingLevel: 'minimal' } } }),
        signal: AbortSignal.timeout(180000),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${out.error?.message ?? ''}`)
      const text = (out.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
      return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      if (attempt === 7) log(`batch failed: ${e.message}`)
    }
  }
  return null
}

const batches = []
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
let next = 0, done = 0, filled = 0
const save = () => writeFileSync(OUT, JSON.stringify(overrides))
async function worker() {
  while (next < batches.length) {
    const batch = batches[next++]
    const input = batch.map((s, k) => ({ k, name: s.name, website: s.website || undefined, backed_by: (s.investors ?? []).slice(0, 3).map((x) => x.name), note: (s.description ?? '').slice(0, 100) || undefined }))
    const file = new URL(`${createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 16)}.json`, DIR)
    let rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    if (!rows) {
      rows = await gemma(`These are startups. For each, give what you know with confidence:
- country: country of headquarters, common English name (e.g. "United States"), or null if unsure
- website: the company's own domain (e.g. "stripe.com"), or null if unsure
- about: one plain sentence on what the company does, or null if unsure
- founded: the year it was founded as an integer, or null if unsure
Never guess. Reply with JSON only: an array of {"k": number, "country": ..., "website": ..., "about": ..., "founded": ...} in input order.

${JSON.stringify(input)}`)
      if (rows) writeFileSync(file, JSON.stringify(rows))
    }
    for (const s of batch) overrides[s.id] = overrides[s.id] ?? {}
    for (const r of rows ?? []) {
      const s = batch[r.k]
      if (!s) continue
      const o = overrides[s.id]
      if (typeof r.country === 'string' && r.country.length < 40) { o.country = r.country; filled++ }
      if (typeof r.website === 'string' && /^[\w.-]+\.[a-z]{2,}$/i.test(r.website)) o.website = r.website.toLowerCase()
      if (typeof r.about === 'string' && r.about.length > 15) o.description = r.about
      if (Number.isInteger(r.founded) && r.founded > 1990 && r.founded <= 2026) o.founded = r.founded
    }
    if (++done % 10 === 0) { log(`${done}/${batches.length} batches, ${filled} countries`); save() }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker))
save()
log(`done: ${filled} countries filled`)
