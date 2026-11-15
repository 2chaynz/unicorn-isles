// Writes src/data/summaries.json: a short investor-facing summary per startup,
// grounded with Google Search because Cala descriptions are often one line.
// Resumable: startups already in the file are skipped. Usage: node scripts/summarize.mjs [limit]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

for (const line of existsSync(new URL('../.env', import.meta.url)) ? readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n') : []) {
  const m = line.match(/^(\w+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const KEY = process.env.GEMINI_API_KEY
if (!KEY) throw new Error('GEMINI_API_KEY missing in .env')
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'
const CONCURRENCY = 12

const startups = JSON.parse(readFileSync(new URL('../src/data/startups.json', import.meta.url), 'utf8'))
const OUT = new URL('../src/data/summaries.json', import.meta.url)
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
// Drop summaries of startups no longer on the map (e.g. ids re-resolved by the import).
const live = new Set(startups.map((s) => s.id))
for (const id of Object.keys(done)) if (!live.has(id)) delete done[id]
const limit = Number(process.argv[2]) || Infinity
const todo = [...new Map(startups.map((s) => [s.id, s])).values()].filter((s) => !done[s.id]).slice(0, limit)

const prompt = (s) => `You brief angel investors on European startups, many of them at Slush 2026.
Company: ${s.name}${s.website ? ` (${s.website})` : ''}${s.country ? `, ${s.country}` : ''}${s.sector ? `, sector ${s.sector}` : ''}${s.founded ? `, founded ${s.founded}` : ''}.
Known facts: ${s.description || 'none'}${s.totalFunding ? `; raised ${s.totalFunding.value} ${s.totalFunding.units}` : s.funding ? `; raised ${s.funding}` : ''}${s.fundingStage ? `; stage ${s.fundingStage}` : ''}${s.investors.length ? `; investors ${s.investors.map((i) => i.name).join(', ')}` : ''}.
Search the web for this exact company. Write 2-3 plain sentences, max 70 words: what it sells and to whom, traction or funding if known, and one reason an investor might care.
No headings, no markdown, no hype. If you can't find this company, say only what the known facts support.`

// Google Search grounding has its own daily quota; once it is spent, summaries are written from
// Cala's facts alone and say so (no web sources).
let grounded = true
async function summarize(s) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: grounded ? prompt(s) : prompt(s).replace('Search the web for this exact company. ', '') }] }],
        ...(grounded ? { tools: [{ google_search: {} }] } : {}),
      }),
    }).catch((e) => (attempt < 5 ? null : Promise.reject(e)))
    if (res?.status === 429 && grounded && /quota/i.test(await res.clone().text())) {
      grounded = false
      console.warn('search grounding quota spent: writing the rest from Cala facts only')
      continue
    }
    if (!res || ((res.status === 429 || res.status >= 500) && attempt < 5)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      continue
    }
    const body = await res.json()
    if (!res.ok) throw new Error(`${s.name}: ${res.status} ${body.error?.message}`)
    const cand = body.candidates?.[0]
    const summary = cand?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!summary) throw new Error(`${s.name}: empty answer`)
    const sources = (cand.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web).filter(Boolean).slice(0, 3).map((w) => ({ title: w.title, uri: w.uri }))
    return { summary, sources, model: MODEL, grounded }
  }
}

let next = 0, finished = 0, failed = 0
const save = () => writeFileSync(OUT, JSON.stringify(done))
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < todo.length) {
    const s = todo[next++]
    try {
      done[s.id] = await summarize(s)
    } catch (e) {
      failed++
      console.error(e.message)
    }
    if (++finished % 20 === 0) { save(); console.log(`${finished}/${todo.length}`) }
  }
}))
save()
console.log(`summaries: ${Object.keys(done).length} total, ${todo.length - failed} new, ${failed} failed`)
