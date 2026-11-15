// Grows the map with real startups from Cala's graph, in bulk: every company a well-known
// investor backed (INVESTED_IN, up to 1000 per call). Cala allows only a few calls a minute, so
// the crawl is paced and every response is cached in .cache/world/ (rerun to resume).
// Sector comes from the industry pages cached by import-world.mjs. Output: .cache/world-startups.json
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const KEY = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/CALA_API_KEY=(\S+)/)[1]
const API = 'https://api.cala.ai/v1'
const DIR = new URL('../.cache/world/', import.meta.url)
const PACE_MS = 6500
mkdirSync(DIR, { recursive: true })

const INVESTORS = [
  // Europe
  'Atomico', 'Index Ventures', 'Balderton Capital', 'Northzone', 'Creandum', 'EQT Ventures', 'Lakestar', 'Accel', 'Seedcamp',
  'LocalGlobe', 'Point Nine', 'Speedinvest', 'HV Capital', 'Earlybird Venture Capital', 'Cherry Ventures', 'Project A Ventures',
  'Partech', 'Eurazeo', 'Kima Ventures', 'Frst', 'Hoxton Ventures', 'Notion Capital', 'Octopus Ventures', 'Molten Ventures',
  'Maki.vc', 'Inventure', 'Lifeline Ventures', 'Voima Ventures', 'Byfounders', 'Seed Capital', 'Plural', 'Visionaries Club',
  'Mosaic Ventures', 'Dawn Capital', 'btov Partners', 'Global Founders Capital', 'La Famiglia', 'Kinnevik', 'Business Finland',
  'European Innovation Council', 'Bpifrance', 'Entrepreneur First', 'Antler', 'Startupbootcamp', 'Techstars', 'Plug and Play',
  // United States
  'Y Combinator', 'Sequoia Capital', 'Andreessen Horowitz', 'Lightspeed Venture Partners', 'General Catalyst', 'Founders Fund',
  'Khosla Ventures', 'Greylock', 'Benchmark', 'Insight Partners', 'Tiger Global Management', 'SV Angel', '500 Global',
  'First Round Capital', 'Bessemer Venture Partners', 'NEA', 'Kleiner Perkins', 'GV', 'Lux Capital', 'Breakthrough Energy Ventures',
  // Rest of the world
  'SoftBank Vision Fund', 'Peak XV Partners', 'Blume Ventures', 'Kaszek', 'Monashees', 'Vertex Ventures', 'East Ventures',
  'Wamda Capital', 'Blackbird Ventures', 'Square Peg Capital', 'Global Brain', 'Qiming Venture Partners',
  // Second wave: the most prolific backers of early-stage companies
  'Pioneer Fund', 'Soma Capital', 'Rebel Fund', 'Liquid 2 Ventures', 'Goodwater Capital', 'Gold House Ventures', 'Precursor Ventures',
  'Hustle Fund', 'Village Global', 'Initialized Capital', 'Uncork Capital', 'Felicis', 'Social Capital', 'Coatue', 'Thrive Capital',
  'Redpoint Ventures', 'Index Ventures', 'Union Square Ventures', 'Spark Capital', 'Craft Ventures', 'FJ Labs', 'Tribe Capital',
  'Correlation Ventures', 'Alumni Ventures', 'Gaingels', 'Mucker Capital', 'MassChallenge', 'Startup Wise Guys', 'Seedstars',
  'EIT InnoEnergy', 'EIT Health', 'European Investment Bank', 'Innovate UK', 'High-Tech Gründerfonds', 'Bayern Kapital',
  'Wayra', 'Station F', 'Kickstart Innovation', 'Rockstart', 'Startup Sauna', 'Nordic Ninja', 'Superhero Capital', 'Icebreaker.vc',
  'Expedition Growth Capital', 'Oxx', 'Moonfire Ventures', 'Firstminute Capital', 'Connect Ventures', 'Passion Capital',
  'Crane Venture Partners', 'Fly Ventures', 'Picus Capital', 'Target Global', 'Headline', 'Creathor Ventures', 'Seaya Ventures',
  'Kibo Ventures', 'JME Ventures', 'Samaipata', 'United Ventures', 'P101', 'Elaia', 'Serena', 'Alven', 'Daphni', 'XAnge',
  'Newfund', 'Axeleo Capital', 'Inovo', 'OTB Ventures', 'Credo Ventures', 'Lightrock', 'Prosus Ventures', 'Mubadala',
  'Sequoia Capital India', 'Accel India', 'Nexus Venture Partners', 'Matrix Partners', 'Hongshan', 'GGV Capital', 'Jungle Ventures',
  'Golden Gate Ventures', 'Antler', 'Draper Associates', 'Alchemist Accelerator', 'SOSV', 'HAX', 'IndieBio', 'Endeavor Catalyst',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
let lastCall = 0
async function call(method, path, body, cacheName) {
  const file = new URL(cacheName, DIR)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 10; attempt++) {
    const wait = lastCall + PACE_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    const res = await fetch(API + path, {
      method, headers: { 'X-API-KEY': KEY, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000),
    }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) { await sleep(20000 * Math.min(3, attempt + 1)); continue }
    if (res.status === 402) throw new Error('Cala credits exhausted')
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) return null
    writeFileSync(file, JSON.stringify(data))
    return data
  }
  return null
}

// Sector per company from the industry pages (first industry wins).
const INDUSTRY_SECTOR = {
  '8190c30d-2703-40ab-94d0-6c193cb53908': 'fintech', '8ecf5e57-a149-438c-9eb4-089809bade56': 'enterprise software',
  'bb7858a2-51d8-45e2-82bd-3ea6a06d317a': 'consumer', 'dd70bbef-ce9b-4560-babf-e60310d2c6b1': 'healthtech',
  'f37c835a-2bdc-4338-9d51-0b2ece520ffe': 'healthtech', '11ce48e0-a853-4085-8142-f674977b1a3a': 'climate tech',
  'cffe9158-e2e5-4727-939a-a419eed30529': 'mobility', 'be9a1964-bfc6-4aad-bde1-1f94bf10cf4c': 'deep tech',
  '0f63c285-f941-493c-9f9a-95ddfdaf52ca': 'materials', '2b930298-6a59-4b80-809e-d446c23b1d1f': 'materials',
}
const sectorOf = new Map()
for (const f of readdirSync(DIR)) {
  const m = f.match(/^page-([0-9a-f-]{36})-\d+\.json$/)
  if (!m) continue
  const d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))
  const sector = INDUSTRY_SECTOR[m[1]] ?? (d.name === 'BIOTECHNOLOGY' || d.name === 'PHARMACEUTICALS' ? 'biotech' : d.name === 'EDUCATION' ? 'edtech' : null)
  if (!sector) continue
  for (const r of d.relationships?.incoming?.OPERATES_IN_INDUSTRY ?? []) if (!sectorOf.has(r.id)) sectorOf.set(r.id, sector)
}
log(`${sectorOf.size} companies with a known industry`)

const companies = new Map()
const save = () => {
  const out = [...companies.values()].map((c) => ({
    id: c.id, name: c.name, sector: c.sector ?? sectorOf.get(c.id) ?? 'other', country: 'Unknown', founded: null, website: null,
    // Headlines of the sources behind the investment say what the company does better than nothing.
    description: [...c.headlines].slice(0, 3).join('. '),
    hq: null, fundingStage: null, totalFunding: null, funding: null, headcount: null, status: null, slush: false,
    rounds: [], investors: c.investors, founders: [], ceo: [], world: true,
  }))
  writeFileSync(new URL('../.cache/world-startups.json', import.meta.url), JSON.stringify(out))
  log(`saved ${out.length} companies`)
}

for (const name of INVESTORS) {
  const found = await call('GET', `/entities?${new URLSearchParams({ name, limit: '5' })}`, null, `inv-${name.replace(/\W+/g, '_')}.json`)
  const inv = (found?.entities ?? []).find((e) => ['Company', 'Organization', 'Investor', 'Fund'].includes(e.entity_type) && e.name.toLowerCase().startsWith(name.toLowerCase().split(' ')[0]))
  if (!inv) { log(`no entity for ${name}`); continue }
  let total = 0
  for (let page = 0; page < 15; page++) {
    const d = await call('POST', `/entities/${inv.id}`, { relationships: { outgoing: { INVESTED_IN: { limit: 1000, offset: page * 1000 } } } }, `pf-${inv.id}-${page}.json`)
    const rows = d?.relationships?.outgoing?.INVESTED_IN ?? []
    for (const r of rows) {
      if (r.entity_type !== 'Company') continue
      const c = companies.get(r.id) ?? { id: r.id, name: r.name, investors: [], headlines: new Set() }
      if (!c.investors.some((x) => x.id === inv.id)) c.investors.push({ id: inv.id, name: inv.name })
      for (const s of r.properties?.sources ?? []) if (s.name && s.name.length > 25 && !/^www\.|\.(com|io|org)$/.test(s.name)) c.headlines.add(s.name)
      companies.set(r.id, c)
    }
    total += rows.length
    if (rows.length < 1000) break
  }
  log(`${name} (${inv.name}): ${total} investments, ${companies.size} companies`)
  save()
}
save()
