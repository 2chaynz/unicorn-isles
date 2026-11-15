import { sigilCells } from './Logo'
import { TILES } from './world'

// Every startup's 5x5 sigil painted once into one canvas, so the map draws all emblems from a
// single texture instead of loading one image per startup while panning.
const PX = 4
const SIZE = 7 * PX
const COLS = 64

function build() {
  const tiles = TILES.filter((t) => t.startup)
  const canvas = document.createElement('canvas')
  canvas.width = COLS * SIZE
  canvas.height = Math.ceil(tiles.length / COLS) * SIZE
  const ctx = canvas.getContext('2d')!
  const mapping: Record<string, { x: number; y: number; width: number; height: number }> = {}
  tiles.forEach((t, i) => {
    const [x, y] = [(i % COLS) * SIZE, Math.floor(i / COLS) * SIZE]
    ctx.fillStyle = `rgb(${t.color.map((v) => Math.round(v * 0.45)).join(',')})`
    ctx.fillRect(x, y, SIZE, SIZE)
    ctx.fillStyle = `rgb(${t.color.map((v) => Math.min(255, v + 90)).join(',')})`
    for (const [cx, cy] of sigilCells(t.startup!.name)) ctx.fillRect(x + (cx + 1) * PX, y + (cy + 1) * PX, PX, PX)
    mapping[t.startup!.id] = { x, y, width: SIZE, height: SIZE }
  })
  return { atlas: canvas.toDataURL('image/png'), mapping }
}

export type Sigils = ReturnType<typeof build>

// Built when the browser is idle after first paint (~100 ms of canvas work it need not block on).
export const SIGILS: Promise<Sigils> = new Promise((resolve) => {
  const run = () => resolve(build())
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 200)
})
