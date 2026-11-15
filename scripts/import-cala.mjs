// Builds src/data/startups.json from Cala's entity graph:
//   1. our Nordic + Baltic startups (from build-from-cache.mjs), names resolved to Cala entities,
//   2. every company attending Slush 2026, the set Cala enriched with funding data.
// Each company is retrieved with funding fields, rounds, investors, founders, CEO, and the
// source, date and source type behind each fact. Sector is left null for companies we had
// not classified; scripts/embed.mjs assigns it from embeddings.
// Every API response is cached in .cache/ so reruns only fetch what is missing. When credits
// run out it stops calling and builds from the cache: our startups keep their previous record,
// uncached Slush companies wait for the next run.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CALA_API_KEY=(\S+)/)[1]
const API = 'https://api.cala.ai/v1'
const CACHE = new URL('../.cache/', import.meta.url)
const OUT = new URL('../src/data/startups.json', import.meta.url)
const CONCURRENCY = 8
const SLUSH_2026 = 'bc844d56-6ab4-452b-96bf-2661e86e592b'

mkdirSync(CACHE, { recursive: true })

let broke = false
async function call(method, path, body) {
  const key = createHash('sha1').update(method + path + JSON.stringify(body ?? '')).digest('hex')
  const file = new URL(`${key}.json`, CACHE)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  if (broke) return null
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { 'X-API-KEY': KEY, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180000),
    }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      continue
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.response_type === 'ERROR') {
      console.warn(`  ${res.status} ${path}`, JSON.stringify(data).slice(0, 200))
      if (res.status === 402 && !broke) {
        broke = true
        console.warn('  Cala credits exhausted: building from cache')
      }
      return null
    }
    writeFileSync(file, JSON.stringify(data))
    return data
  }
  console.warn(`  gave up ${path}`)
  return null
}

async function pool(items, fn) {
  const out = []
  let i = 0
  let done = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
      if (++done % 100 === 0) console.log(`  ${done}/${items.length}`)
    }
  }))
  return out
}

// Some Cala text arrives as UTF-8 read as Latin-1 ("â€”"); undo that when it round-trips cleanly.
const fixText = (s) => {
  if (typeof s !== 'string' || !/[ÃÂâ]/.test(s)) return s
  const fixed = Buffer.from(s, 'latin1').toString('utf8')
  return fixed.includes('�') ? s : fixed
}
const LEGAL = /\b(oyj|oy|ab|as|asa|a\/s|aps|ltd|limited|inc|oü|ou|uab|sia|gmbh|ehf|hf|plc|llc|holding|holdings|group|technologies|ag|bv|sa)\b\.?/g
const norm = (s) => fixText(s).toLowerCase().replace(LEGAL, '').replace(/[^a-z0-9]/g, '')

// 1. Our startups: keep sector and country, resolve ids that are not Cala entities yet.
const previous = JSON.parse(readFileSync(new URL('../src/data/startups.json', import.meta.url), 'utf8'))
const ours = [...new Map(previous.map((s) => [s.id, s])).values()]
const unlinked = ours.filter((s) => s.id.startsWith('q-'))
console.log(`resolve: ${unlinked.length} names`)
const resolved = await pool(unlinked, async (s) => {
  const hits = await call('GET', `/entities?${new URLSearchParams({ name: s.name, entity_types: 'Company', limit: '5' })}`)
  const list = Array.isArray(hits) ? hits : hits?.entities ?? []
  return list.find((e) => norm(e.name) === norm(s.name))?.id ?? null
})
const seeds = new Map()
ours.forEach((s) => {
  const id = s.id.startsWith('q-') ? resolved[unlinked.indexOf(s)] : s.id
  if (id && !seeds.has(id)) seeds.set(id, { id, sector: s.sector, country: s.country, old: s })
})
console.log(`resolved ${resolved.filter(Boolean).length}/${unlinked.length}`)
const keptUnlinked = ours.filter((s) => s.id.startsWith('q-') && !resolved[unlinked.indexOf(s)])

// 2. Slush 2026 attendees.
const attendees = []
for (let offset = 0; ; offset += 1000) {
  const page = await call('POST', `/entities/${SLUSH_2026}`, { relationships: { incoming: { PARTICIPATES_IN_EVENT: { limit: 1000, offset } } } })
  const rows = page?.relationships?.incoming?.PARTICIPATES_IN_EVENT ?? []
  attendees.push(...rows)
  if (rows.length < 1000) break
}
const slush = new Set(attendees.map((a) => a.id))
for (const a of attendees) if (a.entity_type === 'Company' && !seeds.has(a.id)) seeds.set(a.id, { id: a.id, sector: null, country: null })
console.log(`slush: ${attendees.length} attendees, ${seeds.size} companies to retrieve`)

// 3. Details.
const QUERY = {
  properties: ['name', 'website', 'description', 'founding_date', 'headquarters_address', 'operational_status',
    'employee_count_range', 'total_funding', 'total_funding_units', 'funding_stage'],
  relationships: {
    outgoing: {
      OPERATES_IN_INDUSTRY: { limit: 5 },
      PARTICIPATES_IN_FUNDING_ROUND: { limit: 30 },
    },
    incoming: { INVESTED_IN: { limit: 60 }, FOUNDED: { limit: 10 }, IS_CEO_OF: { limit: 3 } },
  },
}
const RANK = ['FILING', 'PRIMARY', 'PRESS', 'AGGREGATOR']
// The strongest source behind a fact: official filings first, then the company, press, databases.
const best = (sources = []) => {
  const s = [...sources].sort((a, b) => (RANK.indexOf(a.source_rank) + 1 || 9) - (RANK.indexOf(b.source_rank) + 1 || 9))[0]
  return s?.document ? { name: s.name, url: s.document, date: s.date ?? null, rank: s.source_rank ?? null } : undefined
}
const val = (p, k) => fixText(p?.[k]?.value ?? null)
const countryOf = (address) => address?.split(',').map((x) => x.trim()).filter(Boolean).pop() ?? null
const roundDate = (r) => (r.properties?.sources ?? []).map((s) => s.date).filter(Boolean).sort()[0] ?? null

// A name match is wrong when the founding year cannot be our startup's (we pulled 2015+ founders).
const mismatched = new Set()
console.log('details:')
const details = await pool([...seeds.values()], async (seed) => {
  const d = await call('POST', `/entities/${seed.id}`, QUERY)
  if (!d?.properties) return null
  const p = d.properties
  const year = +String(val(p, 'founding_date') ?? '').slice(0, 4) || null
  if (seed.old?.id.startsWith('q-') && year && (year < 2005 || (seed.old.founded && Math.abs(year - seed.old.founded) > 3))) {
    mismatched.add(seed.id)
    return null
  }
  const out = d.relationships?.outgoing ?? {}
  const inc = d.relationships?.incoming ?? {}
  const founded = val(p, 'founding_date')
  const funding = p.total_funding?.value
  const headcount = p.employee_count_range?.value
  const prov = Object.fromEntries(['description', 'founding_date', 'headquarters_address', 'total_funding', 'funding_stage', 'employee_count_range', 'operational_status']
    .map((k) => [k, best(p[k]?.sources)]).filter(([, v]) => v))
  return {
    id: d.id,
    name: val(p, 'name') ?? seed.old?.name ?? d.name,
    sector: seed.sector,
    country: seed.country ?? countryOf(val(p, 'headquarters_address')),
    founded: founded ? +String(founded).slice(0, 4) : seed.old?.founded ?? null,
    website: val(p, 'website') ?? seed.old?.website ?? null,
    description: val(p, 'description') || seed.old?.description || '',
    hq: val(p, 'headquarters_address') ?? seed.old?.hq ?? null,
    fundingStage: val(p, 'funding_stage'),
    totalFunding: typeof funding === 'number' ? { value: funding, units: val(p, 'total_funding_units') ?? 'USD' } : null,
    funding: seed.old?.funding ?? null,
    headcount: Array.isArray(headcount) ? headcount.join('–') : headcount ?? null,
    status: val(p, 'operational_status'),
    slush: slush.has(d.id),
    rounds: (out.PARTICIPATES_IN_FUNDING_ROUND ?? [])
      .filter((r) => (r.properties?.role ?? 'ISSUER') === 'ISSUER')
      .map((r) => ({ id: r.id, name: r.name, date: roundDate(r) }))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    investors: (inc.INVESTED_IN ?? []).map((x) => ({ id: x.id, name: fixText(x.name), type: x.entity_type })),
    founders: (inc.FOUNDED ?? []).map((x) => ({ id: x.id, name: fixText(x.name) })),
    ceo: (inc.IS_CEO_OF ?? []).map((x) => ({ id: x.id, name: fixText(x.name) })),
    prov,
  }
})

// Slush lists investors and corporates too; keep companies that look like startups.
const thisYear = new Date().getFullYear()
const isStartup = (s) => s.description && s.status !== 'INACTIVE'
  && (s.fundingStage || s.rounds.length || (s.founded && s.founded >= thisYear - 15))
const fromCala = details.filter(Boolean).filter((s) => s.sector || isStartup(s))
const seedList = [...seeds.values()]
// Our startups whose details are not fetched yet keep their previous record, under the resolved id.
const waiting = seedList.filter((seed, i) => !details[i] && seed.old)
  .map((seed) => (mismatched.has(seed.id) ? { ...seed.old, slush: false } : { ...seed.old, id: seed.id, slush: slush.has(seed.id) }))
const startups = [...fromCala, ...waiting, ...keptUnlinked.map((s) => ({ ...s, slush: false }))]
if (broke) console.log(`credits ran out: ${seedList.filter((seed, i) => !details[i] && !seed.old).length} Slush companies still to fetch; rerun when topped up`)
// Sources go to their own file: they are a third of the data and the page loads them after first paint.
const PROV = new URL('../src/data/prov.json', import.meta.url)
// Startups kept from the previous file carry no prov any more: keep their earlier sources.
const earlier = existsSync(PROV) ? JSON.parse(readFileSync(PROV, 'utf8')) : {}
const prov = Object.fromEntries(startups.map((s) => [s.id, s.prov && Object.keys(s.prov).length ? s.prov : earlier[s.id]]).filter(([, p]) => p))
writeFileSync(OUT, JSON.stringify(startups.map(({ prov: _, sources: __, industries: ___, ...s }) => s)))
writeFileSync(PROV, JSON.stringify(prov))
console.log(`${mismatched.size} name matches rejected (founding year does not fit)`)
console.log(`wrote ${startups.length} startups: ${fromCala.length} detailed from Cala, ${waiting.length - mismatched.size} awaiting details (${fromCala.filter((s) => s.slush).length} at Slush, ${fromCala.filter((s) => s.totalFunding).length} with funding), ${keptUnlinked.length} unlinked kept`)
