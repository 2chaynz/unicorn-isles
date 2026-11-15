// The favicon service has nothing for some of the best-known companies. For the highest-valued ones that
// still have no logo, read the company's own website: its apple-touch-icon or icon (largest first), then its
// social image, then a logo service. Saves PNGs into .cache/logos/<domain>.png, which atlas.mjs picks up.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const w = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'))
const all = JSON.parse(readFileSync(new URL('../data/world-startups.json', import.meta.url), 'utf8'))
const byId = new Map(all.map((s) => [s.id, s]))
const domainOf = (u) => u?.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase() || null
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const todo = w.id.map((_, i) => i)
  .filter((i) => w.value[i] > 0 && w.valueSrc[i] > 0 && w.valueSrc[i] < 3 && w.logo[i] < 0 && domainOf(byId.get(w.id[i])?.website))
  .sort((a, b) => w.value[b] - w.value[a])
log(`${todo.length} valued companies with a website but no logo`)

async function get(url, ms = 9000) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Mozilla/5.0 (compatible; logo-fetch)' } })
    return res.ok ? res : null
  } catch { return null }
}
async function image(url) {
  const res = await get(url)
  if (!res) return null
  const buf = Buffer.from(await res.arrayBuffer())
  try {
    const meta = await sharp(buf).metadata()
    if ((meta.width ?? 0) < 40 || (meta.height ?? 0) < 40) return null
    return await sharp(buf).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  } catch { return null }
}
async function find(domain) {
  for (const host of [`https://${domain}`, `https://www.${domain}`]) {
    const res = await get(host)
    if (!res) continue
    const html = (await res.text()).slice(0, 200000)
    const base = res.url
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
      .filter((t) => /rel=["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(t) && !/mask-icon/i.test(t))
      .map((t) => ({ href: t.match(/href=["']([^"']+)["']/i)?.[1], size: parseInt(t.match(/sizes=["'](\d+)/i)?.[1] ?? '0', 10), touch: /apple-touch-icon/i.test(t) }))
      .filter((l) => l.href && !/\.svg(\?|$)/i.test(l.href))
      .sort((a, b) => (b.touch - a.touch) || b.size - a.size)
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    for (const url of [...links.map((l) => l.href), og].filter(Boolean)) {
      const out = await image(new URL(url, base).href)
      if (out) return out
    }
  }
  return image(`https://logo.clearbit.com/${domain}`)
}

let next = 0, found = 0
async function worker() {
  while (next < todo.length) {
    const i = todo[next++]
    const domain = domainOf(byId.get(w.id[i]).website)
    const png = new URL(`../.cache/logos/${domain}.png`, import.meta.url)
    if (existsSync(png)) continue
    const out = await find(domain)
    if (out) {
      writeFileSync(png, out)
      const miss = new URL(`../.cache/logos/${domain}.miss`, import.meta.url)
      if (existsSync(miss)) unlinkSync(miss)
      found++
    }
    if (next % 25 === 0) log(`${next}/${todo.length}, ${found} logos found`)
  }
}
await Promise.all(Array.from({ length: 8 }, worker))
log(`done: ${found} logos found for ${todo.length} companies`)

// Phase 2: valued companies with no website at all. Try likely domains from the name and keep one only when the
// page's own title or site name mentions the company; the domain is saved as the company's website.
const OVR = new URL('../.cache/enrich-overrides.json', import.meta.url)
const overrides = existsSync(OVR) ? JSON.parse(readFileSync(OVR, 'utf8')) : {}
const LEGAL = /\b(pbc|inc|llc|ltd|limited|corp|corporation|gmbh|oy|ab|as|aps|ag|bv|sa|sas|plc|co|company|holdings?|group|technologies|labs?)\b\.?/gi
const none = w.id.map((_, i) => i)
  .filter((i) => w.value[i] > 0 && w.valueSrc[i] > 0 && w.valueSrc[i] < 3 && w.logo[i] < 0 && !domainOf(byId.get(w.id[i])?.website) && !overrides[w.id[i]]?.website)
  .sort((a, b) => w.value[b] - w.value[a])
log(`phase 2: ${none.length} valued companies with no website`)
let at = 0, matched = 0
async function guess() {
  while (at < none.length) {
    const i = none[at++]
    const name = w.name[i].replace(LEGAL, '').replace(/\(.*?\)/g, '').trim()
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const first = name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '')
    if (slug.length < 3 || first.length < 3) continue
    for (const tld of ['com', 'ai', 'io', 'co', 'eu', 'de', 'fr', 'org']) {
      const domain = `${slug}.${tld}`
      const res = await get(`https://${domain}`, 6000)
      if (!res) continue
      const html = (await res.text()).slice(0, 60000).toLowerCase()
      const title = html.match(/<title[^>]*>([^<]*)/)?.[1] ?? ''
      const site = html.match(/property=["']og:site_name["'][^>]+content=["']([^"']+)/)?.[1] ?? ''
      if (!(title.includes(first) || site.includes(first))) continue
      const out = await find(domain)
      const o = overrides[w.id[i]] ??= {}
      o.website = domain
      if (out) writeFileSync(new URL(`../.cache/logos/${domain}.png`, import.meta.url), out)
      matched++
      break
    }
    writeFileSync(OVR, JSON.stringify(overrides))
  }
}
await Promise.all(Array.from({ length: 8 }, guess))
log(`phase 2 done: ${matched} websites matched`)
