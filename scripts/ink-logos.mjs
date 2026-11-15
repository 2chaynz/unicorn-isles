// Turns the colour logo sheet (.cache/atlas-logos.png, written by scripts/atlas.mjs) into the two
// sheets the page loads, as WebP with the content hash in the name so a browser can never pair a
// stale sheet with new data:
//   public/atlas-logos.<hash>.webp      colour
//   public/atlas-logos-ink.<hash>.webp  round black-and-white "ink stamps", multiplied over each node
// world.json's sprite.url and sprite.ink point at them. Run after scripts/atlas.mjs (which calls this).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export async function inkLogos() {
  const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url))
  const meta = JSON.parse(readFileSync(path('src/data/world.json'), 'utf8'))
  const { cols, cell, width, height } = meta.sprite
  const src = path('.cache/atlas-logos.png')
  const hash = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 10)
  const rows = Math.round(height / cell)
  const r = cell / 2 - 0.5
  const circles = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => `<circle cx="${x * cell + cell / 2}" cy="${y * cell + cell / 2}" r="${r}"/>`).join('')).join('')
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="#fff">${circles}</g></svg>`)
  for (const old of readdirSync(path('public'))) if (/^atlas-logos.*\.(webp|png)$/.test(old)) unlinkSync(path(`public/${old}`))
  // Colour sheet: each logo on cream, cut to a circle.
  const cream = await sharp(src).flatten({ background: '#fbf6ea' }).toBuffer()
  await sharp(cream).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).webp({ quality: 88, alphaQuality: 100 }).toFile(path(`public/atlas-logos.${hash}.webp`))
  // White paper behind each logo, then greyscale with lifted shadows so the tint stays readable.
  const flat = await sharp(src).flatten({ background: '#ffffff' }).greyscale().linear(0.85, 38).toBuffer()
  await sharp(flat).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).webp({ quality: 88, alphaQuality: 100 }).toFile(path(`public/atlas-logos-ink.${hash}.webp`))
  meta.sprite.url = `atlas-logos.${hash}.webp`
  meta.sprite.ink = `atlas-logos-ink.${hash}.webp`
  writeFileSync(path('src/data/world.json'), JSON.stringify(meta))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await inkLogos()
  console.log('wrote hashed logo sheets in public/')
}
