# Cala map (side project)

Challenge: Cala "Make Unicorns Real". Startup explorer modelled on zig-zag.fm: sectors are islands, startups are tiles, investors navigate. Full UI inventory: `FEATURES.md`.

## Run
```
npm install
npm run dev
```

## Stack
- Vite + React + TypeScript, deck.gl (same renderer as zig-zag).
- Layout: one island per sector, each with its own random silhouette (lobes, stretch, Perlin coast), packed at random bearings (`src/perlin.ts`, `src/layout.ts`). Every land tile is a startup. Inside an island, similar startups are neighbours (`src/data/positions.json`).
- Data: Cala API (`/v1/knowledge/query`, `/v1/entities`), cached in `.cache/`. Mock data only if `src/data/startups.json` is missing.

## Ask (Gemini)
- Box at the top of the map: plain-language questions, e.g. "a startup doing food and AI".
- `POST /api/ask` runs inside the Vite server (`server/ask.mjs`), so `GEMINI_API_KEY` never reaches the browser. Works in `npm run dev` and `npm run preview`; a static deploy needs its own function.
- Flow: query embedding vs `.cache/embeddings.json` → top 30 → Gemini picks up to 8 and says why → picks light up on the map.
- In parallel, Cala answers live (`POST /v1/knowledge/search`, needs `CALA_API_KEY` with credits): sourced prose, its sources, and the startups it names light up if they are on the map. If Cala fails (e.g. no credits), the card says why and the map answer still shows.
- Cala MCP for Claude Code while building: `claude mcp add -s local --transport http cala https://api.cala.ai/mcp/ --header "X-API-KEY: <key>"`.

## Land necks
- `scripts/embed.mjs` flags startups whose embedding sits almost as close to another sector's centroid as to their own (`src/data/bridges.json`, up to 8 per island pair).
- Linked islands are placed side by side and joined by a strip of land; those startups live on it, each on its own sector's side, colour blending across.

## Data pipeline
```
node scripts/import-cala.mjs        # Cala entity graph: our startups + Slush 2026 attendees, with funding fields
node scripts/summarize.mjs         # Gemini web-grounded summary per startup (GEMINI_API_KEY), resumable
node scripts/embed.mjs              # Gemini embeddings -> sectors for new companies, positions, land necks
node scripts/layout.mjs             # precomputed island layout (embed.mjs runs it); the page computes it itself if stale
```
- `import-cala.mjs` caches every Cala response in `.cache/`. When credits run out it builds from the cache and says how many companies are left; rerun after topping up.
- Each fact keeps its strongest source (registry > company > press > database) and date; the panel shows them.
- Round amounts and lead investors are fetched live when a startup is opened (`POST /api/rounds`), cached in `.cache/cala-rounds/`.
- Optional stack: Context.dev / Exa for live news per startup.

## Config
- Saving and sign-in (optional): saved startups live in the browser; with Supabase they follow the user across devices. Sign-in is one step: type your email and click the link we send, no password. Setup:
  1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
  2. Authentication > URL Configuration: set Site URL to where the app runs (http://localhost:5180 in dev).
  3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable key) in `.env` (see `.env.example`).
  The default Supabase email sender is rate limited (a few emails an hour); add custom SMTP for real use. A 6-digit code instead of a link needs custom SMTP too, to edit the email template.
  Without them the app runs as guest, saved on this device only.
- `.env` (gitignored): `CALA_API_KEY`, sent as header `X-API-KEY`. Key from https://console.cala.ai/api-keys.
- `GEMINI_API_KEY` in `.env` for `scripts/summarize.mjs`. Never shipped to the browser: summaries are baked into `src/data/summaries.json`.

## Todo from humans
- [ ] Own branding (name, logo, palette). Copy layout and interactions, not zig-zag's logo or assets.
