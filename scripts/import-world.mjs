// Grows the map from Nordic + Baltic to the world, straight from Cala's entity graph:
//   1. each industry entity -> every company linked to it (OPERATES_IN_INDUSTRY, 1000 per call),
//   2. one projection call per company for profile, funding and investors,
//   3. keeps young, active companies (founded 2010+) and merges them into src/data/startups.json.
// Every response is cached in .cache/world/, so the run can stop and resume at any point.
// Usage: node scripts/import-world.mjs [maxDetails=40000]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CALA_API_KEY=(\S+)/)[1]
const API = 'https://api.cala.ai/v1'
const DIR = new URL('../.cache/world/', import.meta.url)
const MAX_DETAILS = +(process.argv[2] ?? 40000)
const PAGES_PER_INDUSTRY = 12
const MIN_YEAR = 2010
mkdirSync(DIR, { recursive: true })

// Cala industry enum -> raw sector key used by src/data/sectors.ts (names must match exactly).
const INDUSTRIES = {
  FINTECH: 'fintech', SOFTWARE_AND_SERVICES: 'enterprise software', INTERNET_AND_WEB_SERVICES: 'consumer',
  HEALTHCARE_PROVIDERS: 'healthtech', MEDICAL_DEVICES: 'healthtech', BIOTECHNOLOGY: 'biotech', PHARMACEUTICALS: 'biotech',
  RENEWABLE_ENERGY: 'climate tech', MANUFACTURING_AUTOMOTIVE: 'mobility', HARDWARE_AND_EQUIPMENT: 'deep tech',
  RAW_MATERIALS: 'materials', CHEMICALS: 'materials', EDUCATION: 'edtech',
}

let pace = 6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function call(method, path, body, cacheName) {
  const file = cacheName && new URL(cacheName, DIR)
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(API + path, {
      method, headers: { 'X-API-KEY': KEY, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000),
    }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) {
      if (res?.status === 429) pace = Math.max(2, pace - 1)
      await sleep(1500 * 2 ** Math.min(attempt, 4))
      continue
    }
    if (res.status === 402) throw new Error('Cala credits exhausted')
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) return null
    if (file) writeFileSync(file, JSON.stringify(data))
    return data
  }
  return null
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// 1. Industries -> candidate companies.
const candidates = new Map()
const perIndustry = []
// Name search only finds one-word enums; the others were read off companies' industry links.
const KNOWN = {
  SOFTWARE_AND_SERVICES: '8ecf5e57-a149-438c-9eb4-089809bade56', HEALTHCARE_PROVIDERS: 'dd70bbef-ce9b-4560-babf-e60310d2c6b1',
  RAW_MATERIALS: '0f63c285-f941-493c-9f9a-95ddfdaf52ca', MEDICAL_DEVICES: 'f37c835a-2bdc-4338-9d51-0b2ece520ffe',
  MANUFACTURING_AUTOMOTIVE: 'cffe9158-e2e5-4727-939a-a419eed30529', RENEWABLE_ENERGY: '11ce48e0-a853-4085-8142-f674977b1a3a',
  INTERNET_AND_WEB_SERVICES: 'bb7858a2-51d8-45e2-82bd-3ea6a06d317a', HARDWARE_AND_EQUIPMENT: 'be9a1964-bfc6-4aad-bde1-1f94bf10cf4c',
  CHEMICALS: '2b930298-6a59-4b80-809e-d446c23b1d1f',
}
for (const [name, sector] of Object.entries(INDUSTRIES)) {
  const found = KNOWN[name] ? null : await call('GET', `/entities?${new URLSearchParams({ name, entity_types: 'Industry', limit: '3' })}`, null, `ind-${name}.json`)
  const ind = KNOWN[name] ? { id: KNOWN[name], name } : (found?.entities ?? []).find((e) => e.entity_type === 'Industry')
  if (!ind) { log(`no industry entity for ${name}`); continue }
  const ids = []
  for (let page = 0; page < PAGES_PER_INDUSTRY; page++) {
    const d = await call('POST', `/entities/${ind.id}`, { properties: ['name'], relationships: { incoming: { OPERATES_IN_INDUSTRY: { limit: 1000, offset: page * 1000 } } } }, `page-${ind.id}-${page}.json`)
    const rows = d?.relationships?.incoming?.OPERATES_IN_INDUSTRY ?? []
    for (const r of rows) if (r.entity_type === 'Company') { ids.push(r.id); if (!candidates.has(r.id)) candidates.set(r.id, { id: r.id, name: r.name, sector }) }
    if (rows.length < 1000) break
  }
  perIndustry.push(ids)
  log(`${name} (${ind.name}): ${ids.length} companies, ${candidates.size} total`)
}

// Round-robin over industries so a budget cut still covers every sector.
const order = []
const seen = new Set()
for (let i = 0; order.length < candidates.size && perIndustry.some((l) => i < l.length); i++) {
  for (const l of perIndustry) if (l[i] && !seen.has(l[i])) { seen.add(l[i]); order.push(l[i]) }
}
const existing = JSON.parse(readFileSync(new URL('../src/data/startups.json', import.meta.url), 'utf8'))
const have = new Set(existing.map((s) => s.id))
const todo = order.filter((id) => !have.has(id)).slice(0, MAX_DETAILS)
log(`details: ${todo.length} companies (budget ${MAX_DETAILS})`)

// 2. Details.
const QUERY = {
  properties: ['name', 'website', 'description', 'founding_date', 'headquarters_address', 'operational_status',
    'employee_count_range', 'total_funding', 'total_funding_units', 'funding_stage'],
  relationships: { incoming: { INVESTED_IN: { limit: 12 } }, outgoing: { PARTICIPATES_IN_FUNDING_ROUND: { limit: 12 } } },
}
const regions = new Intl.DisplayNames(['en'], { type: 'region' })
const countryOf = (address) => {
  const last = address?.split(',').map((x) => x.trim()).filter(Boolean).pop()
  if (!last) return null
  if (/^[A-Z]{2}$/.test(last)) { try { return regions.of(last) ?? last } catch { return last } }
  return last.length < 40 ? last : null
}
const fixText = (s) => {
  if (typeof s !== 'string' || !/[ÃÂâ]/.test(s)) return s
  const fixed = Buffer.from(s, 'latin1').toString('utf8')
  return fixed.includes('�') ? s : fixed
}
const val = (p, k) => fixText(p?.[k]?.value ?? null)

const results = []
let next = 0, done = 0, kept = 0
const t0 = Date.now()
async function worker() {
  while (next < todo.length) {
    const id = todo[next++]
    const d = await call('POST', `/entities/${id}`, QUERY, `c-${id}.json`)
    done++
    if (d?.properties) {
      const p = d.properties
      const year = +String(val(p, 'founding_date') ?? '').slice(0, 4) || null
      const status = val(p, 'operational_status')
      const desc = val(p, 'description')
      if (year && year >= MIN_YEAR && status !== 'INACTIVE' && desc) {
        const funding = p.total_funding?.value
        const head = p.employee_count_range?.value
        kept++
        results.push({
          id: d.id, name: val(p, 'name') ?? candidates.get(id).name, sector: candidates.get(id).sector,
          country: countryOf(val(p, 'headquarters_address')) ?? 'Unknown', founded: year,
          website: val(p, 'website'), description: desc.slice(0, 400), hq: val(p, 'headquarters_address'),
          fundingStage: val(p, 'funding_stage'),
          totalFunding: typeof funding === 'number' ? { value: funding, units: val(p, 'total_funding_units') ?? 'USD' } : null,
          funding: null, headcount: Array.isArray(head) ? head.join('–') : head ?? null, status, slush: false,
          rounds: (d.relationships?.outgoing?.PARTICIPATES_IN_FUNDING_ROUND ?? []).filter((r) => (r.properties?.role ?? 'ISSUER') === 'ISSUER').map((r) => ({ id: r.id, name: r.name, date: null })),
          investors: (d.relationships?.incoming?.INVESTED_IN ?? []).map((x) => ({ id: x.id, name: fixText(x.name) })),
          founders: [], ceo: [], world: true,
        })
      }
    }
    if (done % 500 === 0) log(`details ${done}/${todo.length}, kept ${kept}, ${(done / ((Date.now() - t0) / 1000)).toFixed(1)}/s`)
    if (done % 2000 === 0) save()
  }
}

function save() {
  const byId = new Map(existing.map((s) => [s.id, s]))
  for (const s of results) if (!byId.has(s.id)) byId.set(s.id, s)
  // Staged in .cache until the run is done, so the dev server does not reload on every save.
  writeFileSync(new URL(process.argv[3] === '--write' ? '../src/data/startups.json' : '../.cache/world-startups.json', import.meta.url), JSON.stringify([...byId.values()]))
  log(`saved ${byId.size} startups`)
}

try {
  await Promise.all(Array.from({ length: 12 }, worker))
} catch (e) {
  log(String(e))
}
save()
