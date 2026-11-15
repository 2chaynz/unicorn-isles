import { useEffect, useState } from 'react'

// Shape written by scripts/atlas.mjs.
interface RawAtlas {
  models: { text: string; logo: string }
  ids: string[]
  xy: number[]
  cluster: number[]
  near: [number, number][][]
  clusters: { label: string; terms: string[]; x: number; y: number; size: number }[]
  logos: {
    members: number[]
    xy: number[]
    near: number[][]
    sprite: { url: string; cols: number; cell: number; width: number; height: number }
  }
}

export interface Cluster { index: number; label: string; terms: string[]; x: number; y: number; size: number; color: [number, number, number] }
export interface Point { id: string; x: number; y: number; cluster: number }
export interface Atlas {
  models: RawAtlas['models']
  points: Point[]
  byId: Map<string, Point>
  clusters: Cluster[]
  // Startups closest in meaning, with cosine similarity.
  near: Map<string, { id: string; score: number }[]>
  logos: Point[]
  logoById: Map<string, Point>
  logoNear: Map<string, string[]>
  sprite: RawAtlas['logos']['sprite'] & { mapping: Record<string, { x: number; y: number; width: number; height: number }> }
}

// Pastel ring of hues, one per cluster, in the map's muted register.
const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function build(raw: RawAtlas): Atlas {
  const points = raw.ids.map((id, i) => ({ id, x: raw.xy[2 * i], y: raw.xy[2 * i + 1], cluster: raw.cluster[i] }))
  const clusters = raw.clusters.map((c, i) => ({ ...c, index: i, color: hsl((i * 137.5) % 360, 0.55, 0.62) }))
  const logos = raw.logos.members.map((m, k) => ({ id: raw.ids[m], x: raw.logos.xy[2 * k], y: raw.logos.xy[2 * k + 1], cluster: raw.cluster[m] }))
  const { cols, cell } = raw.logos.sprite
  const mapping = Object.fromEntries(logos.map((p, k) => [p.id, { x: (k % cols) * cell, y: Math.floor(k / cols) * cell, width: cell, height: cell }]))
  return {
    models: raw.models,
    points,
    byId: new Map(points.map((p) => [p.id, p])),
    clusters,
    near: new Map(raw.near.map((row, i) => [raw.ids[i], row.map(([j, score]) => ({ id: raw.ids[j], score }))])),
    logos,
    logoById: new Map(logos.map((p) => [p.id, p])),
    logoNear: new Map(raw.logos.near.map((row, k) => [logos[k].id, row.map((m) => raw.ids[m])])),
    sprite: { ...raw.logos.sprite, url: `/${raw.logos.sprite.url}`, mapping },
  }
}

// Lazy: the map paints first, the atlas follows.
const files = import.meta.glob<RawAtlas>('../data/atlas.json', { import: 'default' })
let pending: Promise<Atlas | null> | null = null
export const loadAtlas = () => (pending ??= files['../data/atlas.json']?.().then(build) ?? Promise.resolve(null))

export function useAtlas() {
  const [atlas, setAtlas] = useState<Atlas | null>(null)
  useEffect(() => { loadAtlas().then(setAtlas) }, [])
  return atlas
}

export interface Hit { id: string; score: number; name?: boolean }

export async function searchMeaning(q: string): Promise<Hit[]> {
  return post('/api/semantic', { q })
}

export async function searchLogos(body: { q?: string; image?: string; id?: string }): Promise<Hit[]> {
  return post('/api/logos', body)
}

async function post(url: string, body: unknown): Promise<Hit[]> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error(out.error ?? res.statusText)
  return out.hits
}

// Shrinks a dropped picture before upload: CLIP only looks at 224x224 anyway.
export function imageToDataUrl(file: Blob, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')) }
    img.src = url
  })
}

export async function similarTo(id: string): Promise<Hit[]> {
  return post('/api/semantic', { id })
}

export interface CalaAnswer { answer?: string; sources?: { name: string; url: string }[]; entities?: { id: string; name: string; type?: string }[]; error?: string }

// Cala's live, sourced answer (server/ask.mjs, cached per question).
export async function askCala(question: string): Promise<CalaAnswer> {
  const res = await fetch('/api/cala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })
  const out = await res.json().catch(() => ({ error: res.statusText }))
  return res.ok ? out : { error: out.error ?? res.statusText }
}
