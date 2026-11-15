// Builds src/data/startups.json from cached /knowledge/query responses only (no API calls).
// Used while Cala credits are out; import-cala.mjs replaces it with full details later.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const CACHE = new URL('../.cache/', import.meta.url)
const OUT = new URL('../src/data/startups.json', import.meta.url)
// Must match import-cala.mjs so the cache keys line up.
const COUNTRIES = ['Finland', 'Sweden', 'Norway', 'Denmark', 'Iceland', 'Estonia', 'Latvia', 'Lithuania']
const SECTORS = ['fintech', 'healthtech', 'climate tech', 'artificial intelligence', 'robotics', 'gaming',
  'mobility', 'food tech', 'edtech', 'cybersecurity', 'deep tech', 'consumer', 'enterprise software', 'biotech']

// Query rows are model-shaped: the same field comes back under different keys.
const get = (row, ...keys) => {
  for (const k of Object.keys(row)) if (keys.includes(k.toLowerCase().replace(/[\s_]/g, ''))) return row[k]
  return null
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const byName = new Map()
for (const country of COUNTRIES) {
  for (const sector of SECTORS) {
    const body = { input: `startups.location=${country}.industry=${sector}.founded_year>=2015.limit=50` }
    const key = createHash('sha1').update('POST/knowledge/query' + JSON.stringify(body)).digest('hex')
    const file = new URL(`${key}.json`, CACHE)
    if (!existsSync(file)) continue
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const companies = (data.entities ?? []).filter((e) => e.entity_type === 'Company')
    for (const row of data.results ?? []) {
      const name = get(row, 'name', 'startup', 'company', 'companyname')
      if (!name || byName.has(norm(name))) continue
      const entity = companies.find((e) => e.mentions.some((m) => norm(m) === norm(name)) || norm(e.name).startsWith(norm(name)))
      const year = String(get(row, 'foundedyear', 'founded', 'yearfounded') ?? '').match(/\d{4}/)
      const desc = get(row, 'description', 'highlights', 'focus', 'product', 'summary')
      byName.set(norm(name), {
        id: entity?.id ?? `q-${norm(name)}`,
        name,
        sector,
        country,
        founded: year ? +year[0] : null,
        website: null,
        description: [desc, get(row, 'sector', 'industry')].filter(Boolean).join(' · ') || '',
        hq: get(row, 'location', 'city', 'headquarters'),
        funding: get(row, 'totalfunding', 'funding', 'fundingraised', 'raised'),
        rounds: [],
        investors: [],
        founders: [],
        sources: [],
      })
    }
  }
}

const startups = [...byName.values()]
writeFileSync(OUT, JSON.stringify(startups))
console.log(`wrote ${startups.length} startups (${startups.filter((s) => !s.id.startsWith('q-')).length} with Cala ids)`)
