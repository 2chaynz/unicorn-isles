import { useState } from 'react'

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

// Mirrored 5x5 pixel sigil, unique per startup, for companies without a known website.
export function sigilCells(seed: string) {
  let h = hash(seed)
  const cells: [number, number][] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (h & 1) cells.push([x, y], [4 - x, y])
      h = (h >>> 1) || hash(seed + y)
    }
  }
  return cells
}

const light = (c: [number, number, number]) => c.map((v) => Math.min(255, v + 90)).join(',')

export function sigilSvg(seed: string, color: [number, number, number]) {
  const rects = sigilCells(seed).map(([x, y]) => `<rect x='${x}' y='${y}' width='1' height='1' fill='rgb(${light(color)})'/>`).join('')
  return `<svg xmlns='http://www.w3.org/2000/svg' width='70' height='70' viewBox='-1 -1 7 7' shape-rendering='crispEdges'><rect x='-1' y='-1' width='7' height='7' fill='rgb(${color.map((v) => Math.round(v * 0.45)).join(',')})'/>${rects}</svg>`
}

export const sigilUrl = (seed: string, color: [number, number, number]) => `data:image/svg+xml;utf8,${encodeURIComponent(sigilSvg(seed, color))}`

export function faviconUrl(website: string | null) {
  const domain = website?.replace(/^https?:\/\//, '').split('/')[0]
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null
}

export function Logo({ name, website, color, className = 'logo-box' }: { name: string; website: string | null; color: [number, number, number]; className?: string }) {
  const [failed, setFailed] = useState(false)
  const fav = faviconUrl(website)
  return (
    <div className={className}>
      <img src={fav && !failed ? fav : sigilUrl(name, color)} alt="" onError={() => setFailed(true)} />
    </div>
  )
}
