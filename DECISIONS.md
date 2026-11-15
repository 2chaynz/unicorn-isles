# Cala map — decisions

1. **User:** angels and small funds sourcing deals (find unfunded / early startups by sector, stage, country).
2. **Data scope:** vision = all the world's startups; v1 = Nordic + Baltic, founded 2015+, ~1–3k companies, pulled once from Cala into a local JSON.
3. **Island shapes:** Perlin noise coastlines (replace the random-frontier growth in `src/layout.ts`).
4. **Islands:** one per Cala industry/sector. Inside an island, startups placed by description-embedding similarity (neighbours = similar companies).
5. **Embeddings + summaries:** Gemini API (credits). Keep the embedding step swappable so Gemma can replace it later (Gemma tech challenge).
6. **Features (all in scope, built one at a time):** Perlin islands, real Cala data, startup panel (pitch, rounds, investors), filters, search, gem/watchlist, navigate/shuffle/previous, URL state, Gemini summary per startup, investors in common (click investor → their startups light up), exploration map (dim seen), sofa mode, accounts + login, messages. Cut: boat parties, webshop.
7. **Build order:** (1) Cala import → JSON, (2) Perlin islands + Gemini similarity layout, (3) investors in common, (4) Gemini summary, (5) adapt scaffold features to real data, (6) accounts + login (Firebase/Supabase), (7) messages.
8. **Name/branding:** Unicorn Isles. zig-zag mood (black, serif + pixel fonts, boat) with our own palette: gold for unicorns/selection, pastel per sector. No zig-zag logo or assets.
9. **Code home:** branch `2chaynz/cala-map`, worktree `../Junction-cala`. PR to main per AGENTS.md. Dev server: `.claude/launch.json` → "cala-map" (port 5174).
10. **Messages:** one live discussion thread per startup (Supabase Realtime), signed-in users only. No private DMs.
