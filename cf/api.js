// The /api routes on Cloudflare Pages Functions: the same answers as server/semantic.mjs and server/ask.mjs,
// without a filesystem. Data comes from dist/_data (scripts/cf-data.mjs) through the ASSETS binding,
// search embeddings from Workers AI (the same bge-small-en-v1.5 model the vectors were made with),
// and new Cala results are kept in Cloudflare's cache instead of on disk.
//
// Bindings and secrets (wrangler.toml, Cloudflare dashboard or .dev.vars):
//   AI              Workers AI binding
//   ASSETS          static files (provided by Pages)
//   GEMINI_API_KEY  Gemma answers for Ask
//   CALA_API_KEY    optional: live Cala answers and funding rounds beyond the cached ones

const TOP = 80
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5'
const CALA = 'https://api.cala.ai/v1'
const SAFE = /^[A-Za-z0-9_-]{1,80}$/
const MAX_BODY = 100_000
const DAY = 86400

// ---------- static data ----------
const asset = (env, path) => env.ASSETS.fetch(new Request(`https://assets.local/_data/${path}`))
// A missing file comes back as the site's index.html (single-page app fallback), so check it really is JSON.
async function assetJson(env, path) {
  const res = await asset(env, path)
  return res.ok && (res.headers.get('Content-Type') ?? '').includes('json') ? res.json() : null
}

// Ids, names and vectors stay in memory for as long as this worker instance lives.
let index = null
function loadIndex(env) {
  index ??= (async () => {
    const [meta, bin] = await Promise.all([assetJson(env, 'index.json'), asset(env, 'text.bin').then((r) => r.arrayBuffer())])
    const vecs = new Int8Array(bin)
    return { ids: meta.ids, lower: meta.lower, vecs, dim: vecs.length / meta.ids.length }
  })().catch((e) => { index = null; throw e })
  return index
}

// Top matches by dot product; a running top-K list instead of sorting all 5,700 scores.
function rank({ ids, vecs, dim }, q, skip) {
  const best = []
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === skip) continue
    let s = 0
    for (let k = 0, o = i * dim; k < dim; k++) s += vecs[o + k] * q[k]
    s /= 127
    if (best.length === TOP && s <= best[TOP - 1].s) continue
    let j = best.length < TOP ? best.length : TOP - 1
    while (j > 0 && best[j - 1].s < s) { if (j < TOP) best[j] = best[j - 1]; j-- }
    best[j] = { i, s }
  }
  return best.map(({ i, s }) => ({ id: ids[i], score: Math.round(s * 1000) / 1000 }))
}

async function embed(env, text) {
  const out = await env.AI.run(EMBED_MODEL, { text: [QUERY_PREFIX + text], pooling: 'cls' })
  const v = out.data[0]
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return Float32Array.from(v, (x) => x / n)
}

// Hybrid: a startup whose name contains the query goes first, the rest by meaning.
async function semantic(env, q, id) {
  const idx = await loadIndex(env)
  if (id) {
    const k = idx.ids.indexOf(id)
    if (k < 0) return { hits: [] }
    return { hits: rank(idx, Array.from(idx.vecs.subarray(k * idx.dim, (k + 1) * idx.dim), (x) => x / 127), id) }
  }
  const hits = rank(idx, await embed(env, q))
  const needle = q.toLowerCase()
  const named = []
  if (needle.length > 2) for (let i = 0; i < idx.lower.length && named.length < 5; i++) if (idx.lower[i].includes(needle)) named.push({ id: idx.ids[i], score: 1, name: true })
  const seen = new Set(named.map((h) => h.id))
  return { hits: [...named, ...hits.filter((h) => !seen.has(h.id))].slice(0, TOP) }
}

async function startup(env, id) {
  const s = SAFE.test(id) ? await assetJson(env, `s/${id}.json`) : null
  if (!s) throw new Error('unknown startup')
  return s
}

// ---------- Cala, with Cloudflare's cache standing in for the .cache folder ----------
const cacheKey = (kind, key) => new Request(`https://cache.unicorn-isles.local/${kind}/${key}`)
async function cached(kind, key) {
  const hit = await caches.default.match(cacheKey(kind, key))
  return hit ? hit.json() : null
}
function remember(ctx, kind, key, value, days = 30) {
  const res = new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${days * DAY}` } })
  ctx.waitUntil(caches.default.put(cacheKey(kind, key), res))
}
async function sha1(text) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function calaSearch(env, ctx, question) {
  const h = await sha1(question.toLowerCase())
  const known = (await assetJson(env, `answers/${h}.json`)) ?? (await cached('answers', h))
  if (known) return known
  const key = env.CALA_API_KEY
  if (!key) return { error: 'Cala is not connected on this site yet (CALA_API_KEY missing)' }
  try {
    const res = await fetch(`${CALA}/knowledge/search`, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: question, return_entities: true }),
      signal: AbortSignal.timeout(120000),
    })
    const body = await res.json()
    if (!res.ok) return { error: `Cala ${res.status}: ${body.detail ?? res.statusText}` }
    const sources = new Map()
    for (const bit of body.context ?? []) {
      for (const o of bit.origins ?? []) {
        const ref = o.document?.url ? o.document : o.source
        if (ref?.url && !sources.has(ref.url)) sources.set(ref.url, { name: ref.name || ref.url.replace(/^https?:\/\//, '').split('/')[0], url: ref.url })
      }
    }
    const out = {
      answer: body.content ?? '',
      sources: [...sources.values()].slice(0, 6),
      entities: (body.entities ?? []).map((e) => ({ id: e.id, name: e.name, type: e.entity_type })),
    }
    remember(ctx, 'answers', h, out, 7)
    return out
  } catch (e) {
    return { error: `Cala: ${e.message}` }
  }
}

const RANK = ['FILING', 'PRIMARY', 'PRESS', 'AGGREGATOR']
const ROUND_QUERY = {
  properties: ['name', 'round_label', 'instrument', 'transaction_value', 'transaction_value_units', 'announcement_date', 'event_date'],
  relationships: { incoming: { PARTICIPATES_IN_FUNDING_ROUND: { limit: 40 } } },
}

async function calaRounds(env, ctx, id) {
  const s = await startup(env, id).catch(() => null)
  if (!s?.rounds?.length) return { rounds: [] }
  const key = env.CALA_API_KEY
  const rounds = await Promise.all(s.rounds.map(async (r) => {
    if (!SAFE.test(r.id)) return { id: r.id, name: r.name, date: r.date, error: 'bad id' }
    const known = (await assetJson(env, `rounds/${r.id}.json`)) ?? (await cached('rounds', r.id))
    if (known) return known
    if (!key) return { id: r.id, name: r.name, date: r.date, error: 'Cala not connected' }
    const res = await fetch(`${CALA}/entities/${r.id}`, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(ROUND_QUERY),
      signal: AbortSignal.timeout(60000),
    }).catch((e) => ({ ok: false, status: e.name === 'TimeoutError' ? 'timeout' : 'network' }))
    const d = res.ok ? await res.json().catch(() => ({})) : {}
    if (!res.ok || !d.properties) return { id: r.id, name: r.name, date: r.date, error: `Cala ${res.status}` }
    const v = (k) => d.properties[k]?.value ?? null
    const sources = Object.values(d.properties).flatMap((p) => p?.sources ?? [])
      .sort((a, b) => (RANK.indexOf(a.source_rank) + 1 || 9) - (RANK.indexOf(b.source_rank) + 1 || 9))
    const people = (d.relationships?.incoming?.PARTICIPATES_IN_FUNDING_ROUND ?? []).filter((x) => x.properties?.role !== 'ISSUER')
    const out = {
      id: r.id,
      name: v('name') ?? r.name,
      label: v('round_label'),
      instrument: v('instrument'),
      amount: v('transaction_value'),
      units: v('transaction_value_units'),
      date: v('event_date') ?? v('announcement_date') ?? r.date,
      leads: people.filter((x) => x.properties?.is_lead).map((x) => ({ id: x.id, name: x.name })),
      others: people.filter((x) => !x.properties?.is_lead).map((x) => ({ id: x.id, name: x.name })),
      source: sources[0]?.document ? { name: sources[0].name, url: sources[0].document, date: sources[0].date ?? null, rank: sources[0].source_rank ?? null } : null,
    }
    remember(ctx, 'rounds', r.id, out)
    return out
  }))
  // Without a Cala key, rounds nobody fetched yet are left out rather than shown as errors.
  const shown = key ? rounds : rounds.filter((r) => !r.error)
  return { rounds: shown.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))) }
}

// ---------- Gemma ----------
const GEMMAS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']
async function gemmaCall(key, prompt) {
  let last = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    const model = GEMMAS[attempt % GEMMAS.length]
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: 'minimal' } } }),
      signal: AbortSignal.timeout(90000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }))
    const out = await res.json().catch(() => ({}))
    if (res.ok) return { out, model }
    last = `gemma ${res.status}: ${out.error?.message ?? ''}`
    if (res.status !== 0 && res.status !== 429 && res.status < 500) break
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw new Error(last)
}

async function askGemma(env, question) {
  const key = env.GEMINI_API_KEY
  if (!key) throw new Error('Ask is not connected on this site yet (GEMINI_API_KEY missing)')
  const { hits } = await semantic(env, question)
  const records = await Promise.all(hits.slice(0, 24).map((h) => startup(env, h.id).catch(() => null)))
  const shortlist = records.filter(Boolean).map((s) => ({
    id: s.id, name: s.name, country: s.country, founded: s.founded,
    raised: s.totalFunding ? `${s.totalFunding.value} ${s.totalFunding.units}` : undefined,
    investors: (s.investors ?? []).slice(0, 3).map((i) => i.name),
    about: (s.summary?.summary ?? s.description ?? '').slice(0, 220),
  }))
  const prompt = `You help investors and founders explore startups. Answer the question using only the candidates below.
Reply with JSON only, no reasoning, in this exact shape:
{"answer": "1-3 plain sentences", "picks": [{"id": "<candidate id>", "why": "one short reason"}]}
Pick up to 8 candidates that fit best. If none fit, say so in "answer" and return an empty "picks".

Question: ${question}

Candidates:
${JSON.stringify(shortlist)}`
  const { out, model } = await gemmaCall(key, prompt)
  // Gemma may think out loud before the JSON; keep the last object that parses.
  const text = (out.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  let parsed = null
  for (let end = text.lastIndexOf('}'); end > 0 && !parsed; end = text.lastIndexOf('}', end - 1)) {
    for (let start = text.lastIndexOf('{', end); start >= 0 && !parsed; start = text.lastIndexOf('{', start - 1)) {
      try { const v = JSON.parse(text.slice(start, end + 1)); if (v && 'answer' in v) parsed = v } catch { /* keep looking */ }
    }
  }
  const valid = new Set(shortlist.map((s) => s.id))
  return {
    answer: parsed?.answer ?? 'Gemma did not return an answer.',
    picks: (parsed?.picks ?? []).filter((p) => valid.has(p.id)).slice(0, 8),
    model,
  }
}

// ---------- routes ----------
const text = (b, k, max) => {
  const q = String(b[k] ?? '').trim().slice(0, max)
  if (!q) throw new Error(k === 'q' ? 'empty query' : 'empty question')
  return q
}
const ROUTES = {
  semantic: (b, env) => (b.id ? semantic(env, '', String(b.id)) : semantic(env, text(b, 'q', 300))),
  startup: async (b, env) => (Array.isArray(b.ids)
    ? (await Promise.all(b.ids.slice(0, 60).map((id) => startup(env, String(id)).then((s) => ({
      id: s.id, name: s.name, country: s.country, founded: s.founded, totalFunding: s.totalFunding, stage: s.fundingStage, investors: s.investors ?? [],
    })).catch(() => null)))).filter(Boolean)
    : startup(env, String(b.id ?? ''))),
  rounds: (b, env, ctx) => calaRounds(env, ctx, String(b.id ?? '')),
  cala: (b, env, ctx) => calaSearch(env, ctx, text(b, 'question', 500)),
  'ask-gemma': (b, env) => askGemma(env, text(b, 'question', 400)),
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

export async function handle(ctx) {
  const route = ROUTES[ctx.params.route]
  if (!route) return json({ error: 'not found' }, 404)
  const raw = await ctx.request.text()
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413)
  try {
    return json(await route(JSON.parse(raw || '{}'), ctx.env, ctx))
  } catch (e) {
    return json({ error: e.message }, 500)
  }
}
