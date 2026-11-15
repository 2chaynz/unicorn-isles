# Unicorn Isles

A pixel-art sea chart of 5,736 young startups. Sail it with WASD, ask it questions, leave with a shortlist. Built on Cala's knowledge graph.

- Live demo: https://unicorn-isles.onrender.com (free hosting: the first visit can take up to a minute to wake up)
- Challenge: Cala, "Make Unicorns Real", Junction 2026
- Built during Junction 2026 in Espoo, 13–15 November 2026.

## What it does
- **Europe view**: every country drawn in its real shape, made of its own startups (37 countries, 3,086 startups). Dot size is valuation.
- **Meaning view**: the same dots move next to the companies most like them (t-SNE over description embeddings, 22 themes).
- **Search**: describe a company in plain words; matches light up on the map.
- **Ask**: a full question goes to Cala's knowledge search (answer with sources); Gemma picks the matching startups.
- **Startup card**: backers, closest competitors, stage, valuation, and where each fact came from.
- **Shortlist**: filter by stage, sector, funding or unicorn; save with F, export CSV, or sign in by email link to sync across devices.
- Sailing: WASD moves the boat, E opens the nearest startup, F saves it. Eino and the sea creatures are there for fun.

## Run
Node 20+.
```
npm install
cp .env.example .env      # fill in the keys below
npm run dev               # http://localhost:5180
```
Production: `npm run build && npx vite preview --host 0.0.0.0 --port $PORT` (the `Dockerfile` does this). `vite preview` also serves the `/api` routes.

### Environment
| Name | Used for |
|---|---|
| `CALA_API_KEY` | Cala API: data import, Ask answers, funding rounds. Header `X-API-KEY` |
| `GEMINI_API_KEY` | Gemma (via the Gemini API): Ask picks and data gap filling. Server side only |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Optional. Email-link sign-in and synced shortlists. Without them saves stay in the browser |

Supabase setup: run `supabase/schema.sql`, then under Authentication > URL Configuration set the Site URL and add your app's URL to the redirect list.

## How it's built
- Vite, React, TypeScript, deck.gl. Pixel sprites are drawn in code (`src/v2/sprites.ts`).
- Server routes run inside Vite (`server/semantic.mjs`, `server/ask.mjs`), so API keys never reach the browser.
- Search embeddings (bge-small) run locally with transformers.js.

### Data pipeline
```
node scripts/import-world.mjs       # companies, funding and investors from Cala's entity graph (cached in .cache/)
node scripts/import-valuations.mjs  # latest valuations from Cala's knowledge query
node scripts/enrich-gemma.mjs       # fill gaps with Gemma; anything it fills is flagged as model-made
node scripts/atlas.mjs              # embeddings, meaning map, themes, logo sprite sheet
node scripts/relayout-world.mjs     # Europe map: country shapes from Natural Earth outlines
```
Kept: companies founded in 2020 or later. Dropped: acquired, listed and name-only records.

## Licence
MIT, see `LICENSE`. Data comes from Cala and is subject to Cala's terms.
