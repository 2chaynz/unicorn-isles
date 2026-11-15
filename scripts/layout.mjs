// Precomputes the island layout into src/data/layout.json, so the browser skips it at load.
// Feeds layoutIslands exactly what src/data/load.ts and src/world.ts would.
// Run after scripts/embed.mjs (embed.mjs runs it for you).
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'

const src = (f) => new URL(`../src/${f}`, import.meta.url)
const { outputFiles } = await build({
  stdin: { contents: "export * from './layout'; export { SECTOR_LABEL } from './data/sectors'", resolveDir: src('.').pathname, loader: 'ts' },
  bundle: true, format: 'esm', write: false, platform: 'node',
})
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

const json = (f) => JSON.parse(readFileSync(src(`data/${f}`), 'utf8'))
const label = (s) => mod.SECTOR_LABEL[s] ?? s
const seen = new Set()
const startups = json('startups.json').filter((s) => !seen.has(s.id) && seen.add(s.id)).map((s) => ({ ...s, sector: label(s.sector) }))
const sectors = [...new Set(startups.map((s) => s.sector))].sort()
const positions = json('positions.json')
const links = json('bridges.json').map((b) => ({ id: b.id, to: label(b.to) }))

const t = performance.now()
const layout = mod.layoutIslands(startups, sectors, positions, links)
writeFileSync(src('data/layout.json'), JSON.stringify(mod.packLayout(mod.layoutKey(startups, positions, links), layout)))
console.log(`layout: ${layout.tiles.length} tiles in ${Math.round(performance.now() - t)} ms -> src/data/layout.json`)
