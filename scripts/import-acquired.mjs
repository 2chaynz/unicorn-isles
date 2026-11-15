// Which companies are no longer independent? Asks Cala's knowledge graph for the acquisitions of ~40 big
// acquirers (and the top few over two periods) with /knowledge/query. atlas.mjs drops every company named here:
// a startup that has been bought is not a startup any more (Instagram, Wolt, Looker...).
// Cached in .cache/acquired/; output .cache/acquired.json { <name key>: { name, by } }
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CALA_API_KEY=(\S+)/)[1]
const DIR = new URL('../.cache/acquired/', import.meta.url)
const OUT = new URL('../.cache/acquired.json', import.meta.url)
mkdirSync(DIR, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const BIG = ['Meta', 'Alphabet (Google)', 'Microsoft', 'Amazon', 'Apple', 'Salesforce', 'Oracle', 'SAP', 'Adobe', 'Cisco', 'IBM', 'Intel']
const MORE = ['Nvidia', 'Uber', 'DoorDash', 'PayPal', 'Visa', 'Mastercard', 'eBay', 'Shopify', 'Twilio', 'Atlassian', 'Broadcom', 'Qualcomm', 'AMD',
  'Palo Alto Networks', 'CrowdStrike', 'Datadog', 'Snowflake', 'OpenAI', 'Tencent', 'Alibaba', 'Spotify', 'Stripe', 'Intuit', 'ServiceNow',
  'Workday', 'Zoom', 'Block (Square)', 'Coinbase', 'Booking Holdings', 'Delivery Hero', 'Prosus', 'Nokia', 'Ericsson', 'Siemens', 'Bosch', 'Roche', 'Novartis']
const QUESTIONS = [
  ...BIG.flatMap((a) => [`companies acquired by ${a} between 2008 and 2016, with the acquisition year`, `companies acquired by ${a} between 2017 and 2026, with the acquisition year`]),
  ...MORE.map((a) => `companies acquired by ${a}, with the acquisition year`),
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function ask(q) {
  const file = new URL(`${createHash('sha1').update(q).digest('hex').slice(0, 16)}.json`, DIR)
  if (existsSync(file)) return
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.cala.ai/v1/knowledge/query', {
      method: 'POST', headers: { 'X-API-KEY': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ input: q, return_entities: false }), signal: AbortSignal.timeout(170000),
    }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) { await sleep(15000 * (attempt + 1)); continue }
    if (res.status === 402) throw new Error('Cala credits exhausted')
    const data = await res.json().catch(() => null)
    if (res.ok && data) writeFileSync(file, JSON.stringify({ q, ...data }))
    return
  }
}
const nameKey = (n) => (n ?? '').toLowerCase().replace(/\b(pbc|inc|llc|ltd|limited|corp|corporation|gmbh|oy|ab|as|aps|ag|bv|sa|sas|plc|co|company|holdings?|group)\b\.?/g, '').replace(/[^a-z0-9]/g, '')
function collect() {
  const out = {}
  for (const f of readdirSync(DIR)) {
    const d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))
    const by = d.q.replace(/^companies acquired by /, '').split(/,| between/)[0]
    for (const row of d.results ?? []) {
      const key = Object.keys(row).find((k) => /^(acquired|target|company|name|startup)/i.test(k)) ?? Object.keys(row)[0]
      const name = row[key]
      if (typeof name === 'string' && nameKey(name).length > 2) out[nameKey(name)] = { name, by }
    }
  }
  writeFileSync(OUT, JSON.stringify(out))
  return Object.keys(out).length
}
if (process.argv.includes('--collect')) { log(`${collect()} acquired companies`); process.exit(0) }
let next = 0, done = 0
async function worker() {
  while (next < QUESTIONS.length) {
    await ask(QUESTIONS[next++])
    if (++done % 4 === 0) log(`${done}/${QUESTIONS.length} questions, ${collect()} acquired`)
  }
}
await Promise.all(Array.from({ length: 3 }, worker))
log(`done: ${collect()} acquired companies`)
