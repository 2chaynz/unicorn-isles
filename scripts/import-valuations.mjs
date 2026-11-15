// Harvests latest valuations (and market caps of listed companies) from Cala's knowledge graph with
// /knowledge/query, one natural-language question per region x valuation tier (30 rows each).
// Every answer is cached in .cache/valuations/, so reruns only ask what is missing.
// Output: .cache/valuations.json  { <name key>: { eur, text, name, query } }  (applied by atlas.mjs)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CALA_API_KEY=(\S+)/)[1]
const DIR = new URL('../.cache/valuations/', import.meta.url)
const OUT = new URL('../.cache/valuations.json', import.meta.url)
mkdirSync(DIR, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const REGIONS = [
  'the Nordics and Baltics', 'the United Kingdom and Ireland', 'Germany, Austria and Switzerland', 'France and Benelux',
  'Spain, Portugal and Italy', 'Central and Eastern Europe', 'the United States (software and AI)', 'the United States (fintech and crypto)',
  'the United States (health, biotech and climate)', 'the United States (consumer, marketplaces and hardware)', 'Canada', 'Israel',
  'China and Hong Kong', 'India', 'Southeast Asia', 'Japan, Korea and Australia', 'Latin America', 'the Middle East and Africa',
]
const TIERS = [
  ['above 1 billion US dollars', 'startups'],
  ['between 200 million and 1 billion US dollars', 'startups'],
  ['between 30 and 200 million US dollars', 'startups'],
]
const QUESTIONS = [
  ...REGIONS.flatMap((r) => TIERS.map(([t, what]) => `${what} in ${r} with a latest valuation ${t}, with the latest valuation as a number`)),
  ...REGIONS.slice(0, 8).map((r) => `established companies in ${r} that are publicly listed or older than 15 years, with their market capitalization or latest valuation`),
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function ask(q) {
  const file = new URL(`${createHash('sha1').update(q).digest('hex').slice(0, 16)}.json`, DIR)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.cala.ai/v1/knowledge/query', {
      method: 'POST', headers: { 'X-API-KEY': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ input: q, return_entities: false }), signal: AbortSignal.timeout(170000),
    }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) { await sleep(15000 * (attempt + 1)); continue }
    if (res.status === 402) throw new Error('Cala credits exhausted')
    const data = await res.json().catch(() => null)
    if (res.ok && data) { writeFileSync(file, JSON.stringify({ q, ...data })); return data }
    return null
  }
  return null
}

const RATE = { $: 0.92, '€': 1, '£': 1.17 }
const MULT = { b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mn: 1e6, million: 1e6, k: 1e3 }
// "~$75B (~€70B)" -> 70e9; "$10-20M" -> 10e6; returns EUR or null.
export function parseMoney(text) {
  if (typeof text !== 'string') return null
  const re = /([€$£])\s?([\d][\d.,]*)\s?(bn|billion|b|mn|million|m|k)?\b/gi
  const hits = [...text.matchAll(re)].map((m) => ({ cur: m[1], n: parseFloat(m[2].replace(/,/g, '')), unit: m[3]?.toLowerCase() }))
  if (!hits.length) return null
  hits.forEach((h, i) => { h.unit ??= hits.slice(i + 1).find((x) => x.unit)?.unit })
  const pick = hits.find((h) => h.cur === '€' && h.unit) ?? hits.find((h) => h.unit)
  if (!pick || !Number.isFinite(pick.n)) return null
  return Math.round(pick.n * MULT[pick.unit] * RATE[pick.cur])
}
const nameKey = (n) => (n ?? '').toLowerCase().replace(/\b(pbc|inc|llc|ltd|limited|corp|corporation|gmbh|oy|ab|as|aps|ag|bv|sa|sas|plc|co|company|holdings?|group)\b\.?/g, '').replace(/[^a-z0-9]/g, '')

// Cala answers either with text ("~$75B (~€70B)") or a bare number; bare numbers are USD, and a small
// one under a name like latest_valuation_usd_m or an obvious million-scale figure is in millions.
function valueOf(field, v, q = '') {
  if (typeof v === 'number') {
    // A bare small number is in the unit the question's tier implies.
    let unit = 1
    if (v < 1e5) unit = /above 1 billion|established companies/.test(q) ? 1e9 : /between 200 million/.test(q) ? (v < 10 ? 1e9 : 1e6) : 1e6
    return Math.round(v * unit * 0.92)
  }
  return parseMoney(String(v))
}

function collect() {
  const out = {}
  for (const f of readdirSync(DIR)) {
    const d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))
    for (const row of d.results ?? []) {
      const name = row.startup ?? row.company ?? row.name ?? row.company_name ?? Object.values(row)[0]
      const field = Object.keys(row).find((k) => /valuation|market.?cap/i.test(k))
      const eur = field ? valueOf(field, row[field], d.q) : null
      if (!name || !eur) continue
      const k = nameKey(String(name))
      if (k.length > 2 && (!out[k] || out[k].eur < eur)) out[k] = { eur, text: String(row[field]), name: String(name), query: d.q, country: row.country ?? row.headquarters ?? null, sector: row.sector ?? row.industry ?? null }
    }
  }
  writeFileSync(OUT, JSON.stringify(out))
  return Object.keys(out).length
}

if (process.argv.includes('--collect')) { log(`${collect()} valuations`); process.exit(0) }
let next = 0, done = 0
async function worker() {
  while (next < QUESTIONS.length) {
    const q = QUESTIONS[next++]
    await ask(q)
    if (++done % 4 === 0) log(`${done}/${QUESTIONS.length} questions, ${collect()} valuations`)
  }
}
await Promise.all(Array.from({ length: 3 }, worker))
log(`done: ${collect()} valuations`)
