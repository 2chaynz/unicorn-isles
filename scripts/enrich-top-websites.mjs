// The biggest companies by valuation should all have a logo, but valuation-only entries come with no
// website. Asks Gemma for the company domain (null when unsure), European companies first, and merges
// the answers into .cache/enrich-overrides.json, which atlas.mjs applies before fetching logos.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/GEMINI_API_KEY=(\S+)/)[1]
const OUT = new URL('../.cache/enrich-overrides.json', import.meta.url)
const w = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'))
const all = JSON.parse(readFileSync(new URL('../data/world-startups.json', import.meta.url), 'utf8'))
const byId = new Map(all.map((s) => [s.id, s]))
const overrides = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const todo = w.id.map((_, i) => i)
  .filter((i) => w.value[i] > 0 && w.valueSrc[i] > 0 && w.valueSrc[i] < 3 && !byId.get(w.id[i])?.website && !overrides[w.id[i]]?.site_tried)
  .sort((a, b) => (w.europe[w.country[b]] - w.europe[w.country[a]]) || w.value[b] - w.value[a])
log(`${todo.length} valued companies without a website`)

async function gemma(prompt) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = attempt % 2 ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it'
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } } }),
        signal: AbortSignal.timeout(120000),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(`${res.status}`)
      const text = (out.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
      return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))) }
  }
  return null
}

const batches = []
for (let i = 0; i < todo.length; i += 12) batches.push(todo.slice(i, i + 12))
let next = 0, found = 0
async function worker() {
  while (next < batches.length) {
    const batch = batches[next++]
    const input = batch.map((i, k) => ({ k, name: w.name[i], country: w.countries[w.country[i]], valuation_eur: w.value[i] }))
    const rows = await gemma(`Give the official website domain of each company (for example "stripe.com"), or null if you are not sure it is the right company. Never guess.
Reply with JSON only: an array of {"k": number, "website": string or null} in input order.

${JSON.stringify(input)}`)
    for (const r of rows ?? []) {
      const i = batch[r.k]
      if (i === undefined) continue
      const o = overrides[w.id[i]] ??= {}
      o.site_tried = true
      if (typeof r.website === 'string' && /^[\w.-]+\.[a-z]{2,}$/i.test(r.website)) { o.website = r.website.toLowerCase(); found++ }
    }
    writeFileSync(OUT, JSON.stringify(overrides))
  }
}
await Promise.all(Array.from({ length: 3 }, worker))
log(`done: ${found} websites found`)
