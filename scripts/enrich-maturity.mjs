// Separates young ventures from companies that are no longer startups (acquired, listed, long established)
// with Gemma. Only plausible non-startups are screened: those with a valuation, a listing, a Series C+ stage,
// 300+ employees or an age of 9+ years. For each it gives
//   status: "startup" (independent, private, still venture-style) | "acquired" (now owned by or merged into
//           another company, like Instagram) | "established" (mature or listed) | null when unsure
//   maturity: "startup" | "scaleup" | "established"   (null when unsure)
//   public: listed on a stock exchange (true/false/null)
//   employees: approximate headcount (null when unsure)
//   valuation_usd_m: latest valuation / market cap in USD millions, ONLY for well-known companies (else null)
// Output .cache/enrich-maturity.json, applied by atlas.mjs. Gemma answers come from model memory, so the
// page labels them as estimates; Cala-sourced valuations (scripts/import-valuations.mjs) win over them.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/GEMINI_API_KEY=(\S+)/)[1]
const SRC = new URL('../data/world-startups.json', import.meta.url)
const OUT = new URL('../.cache/enrich-maturity.json', import.meta.url)
const DIR = new URL('../.cache/enrich3/', import.meta.url)
const BATCH = 50
const PARALLEL = 5
mkdirSync(DIR, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const all = JSON.parse(readFileSync(SRC, 'utf8'))
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
// Empty entries come from batches that failed; unanswered ones are cached by batch, so retrying is cheap.
const age = (s) => (s.founded ? 2026 - s.founded : null)
const candidate = (s) => s.valuation || s.fromValuation || s.public === true || ['scaleup', 'established'].includes(s.maturityG)
  || /^SERIES_[C-Z]/.test(s.fundingStage ?? '') || (s.employees ?? 0) >= 300 || (age(s) !== null && age(s) >= 9) || (s.totalFunding?.value >= 1e8 && ['USD', 'EUR', 'GBP'].includes(s.totalFunding.units))
const todo = all.filter((s) => candidate(s) && !out[s.id]?.checked)
log(`${all.filter(candidate).length} candidates for the screen`)
log(`${todo.length} of ${all.length} to classify`)

async function gemma(prompt) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = attempt % 2 ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it'
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, thinkingConfig: { thinkingLevel: 'minimal' } } }),
        signal: AbortSignal.timeout(180000),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${body.error?.message ?? ''}`)
      const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
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
let next = 0, done = 0
const save = () => writeFileSync(OUT, JSON.stringify(out))
async function worker() {
  while (next < batches.length) {
    const batch = batches[next++]
    const input = batch.map((s, k) => ({
      k, name: s.name, website: s.website || undefined, founded: s.founded || undefined, country: s.country && s.country !== 'Unknown' ? s.country : undefined,
      note: (s.description ?? '').slice(0, 110) || undefined, backed_by: (s.investors ?? []).slice(0, 2).map((x) => x.name),
    }))
    const file = new URL(`s2-${createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 16)}.json`, DIR)
    let rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    if (!rows) {
      rows = await gemma(`Classify each company using only what you actually know.
- status: "startup" = an independent, privately held, venture-style company (unicorns count); "acquired" = it has been bought by or merged into another company and no longer operates independently (for example Instagram, owned by Meta); "established" = a mature or publicly listed company that is not startup-like any more; null if you do not know the company.
- maturity: "established" = a mature company (listed on an exchange, or founded before 2008, or over 1000 employees); "scaleup" = past the early stage (latest valuation roughly above 300 million USD, or Series C and later, or clearly large and growing fast); "startup" = a young venture-backed company; null if you do not know the company.
- public: true if listed on a stock exchange, false if not, null if unsure.
- employees: approximate number of employees as an integer, or null if unsure.
- valuation_usd_m: latest valuation (or market cap if listed) in millions of US dollars, ONLY if it is a well-known company whose value you know; otherwise null. Never guess.
Reply with JSON only: an array of {"k": number, "status": ..., "maturity": ..., "public": ..., "employees": ..., "valuation_usd_m": ...} in input order.

${JSON.stringify(input)}`)
      if (rows) writeFileSync(file, JSON.stringify(rows))
    }
    if (!rows) continue
    for (const s of batch) out[s.id] = { ...(out[s.id] ?? {}), checked: true }
    for (const r of rows) {
      const s = batch[r.k]
      if (!s) continue
      const o = out[s.id]
      if (['startup', 'acquired', 'established'].includes(r.status)) o.status = r.status
      if (['startup', 'scaleup', 'established'].includes(r.maturity)) o.maturity = r.maturity
      if (typeof r.public === 'boolean') o.public = r.public
      if (Number.isFinite(r.employees) && r.employees > 0) o.employees = Math.round(r.employees)
      if (Number.isFinite(r.valuation_usd_m) && r.valuation_usd_m > 0) o.valuation_usd_m = r.valuation_usd_m
    }
    if (++done % 10 === 0) { log(`${done}/${batches.length} batches`); save() }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker))
save()
log(`done: ${Object.values(out).filter((o) => o.status).length} screened, ${Object.values(out).filter((o) => o.status === 'acquired' || o.status === 'established').length} not startups`)
