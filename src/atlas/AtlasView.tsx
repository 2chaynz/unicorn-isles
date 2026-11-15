import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL } from '@deck.gl/react'
import { LinearInterpolator, OrthographicView } from '@deck.gl/core'
import { IconLayer, PolygonLayer, TextLayer } from '@deck.gl/layers'
import { BY_ID } from '../world'
import { SIGILS, type Sigils } from '../sigils'
import type { Startup } from '../data/types'
import type { Atlas, Cluster, Point } from './data'

export type AtlasMode = 'meaning' | 'logos'
export type ColorBy = 'cluster' | 'sector' | 'stage' | 'funding' | 'age'

export const COLOR_BY: { key: ColorBy; label: string }[] = [
  { key: 'cluster', label: 'theme' },
  { key: 'sector', label: 'island' },
  { key: 'stage', label: 'stage' },
  { key: 'funding', label: 'money raised' },
  { key: 'age', label: 'age' },
]

const STAGE_COLOR: Record<string, [number, number, number]> = {
  Unknown: [70, 70, 74], 'No rounds': [110, 110, 120], 'Pre-seed': [126, 224, 160], Seed: [96, 200, 210],
  'Series A': [120, 150, 240], 'Series B': [190, 130, 235], 'Series C+': [235, 200, 120],
}
export const STAGE_LEGEND = Object.entries(STAGE_COLOR)

// Rough EUR rates (Nov 2026): good enough to compare and sum markets, not for accounting.
const EUR: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.17, SEK: 0.087, NOK: 0.085, DKK: 0.134, ISK: 0.0066, CHF: 1.05, PLN: 0.23, CZK: 0.04,
  KRW: 0.00066, JPY: 0.0061, CAD: 0.67, SGD: 0.69, INR: 0.011, TRY: 0.027, BRL: 0.17, AED: 0.25, BGN: 0.51, PHP: 0.016, IDR: 0.000058,
}
// Total funding in EUR, for a log-scaled gold ramp and market totals.
export const raisedOf = (s: Startup) => {
  const t = s.totalFunding
  return t?.value ? t.value * (EUR[t.units] ?? 0) : 0
}
const ramp = (k: number): [number, number, number] => [
  Math.round(40 + 195 * k), Math.round(40 + 160 * k ** 1.3), Math.round(60 + 60 * k ** 3),
]
const THIS_YEAR = new Date().getFullYear()

export function colorOf(by: ColorBy, p: Point, clusters: Cluster[]): [number, number, number] {
  const tile = BY_ID.get(p.id)
  const s = tile?.startup
  if (!s) return [80, 80, 80]
  switch (by) {
    case 'sector': return tile.color
    case 'stage': return STAGE_COLOR[s.stage] ?? STAGE_COLOR.Unknown
    case 'funding': { const r = raisedOf(s); return r ? ramp(Math.min(1, Math.max(0.08, (Math.log10(r) - 4) / 5))) : [38, 38, 42] }
    case 'age': return s.founded ? ramp(1 - Math.min(1, (THIS_YEAR - s.founded) / 12)) : [38, 38, 42]
    default: return clusters[p.cluster].color
  }
}

const MAX_ZOOM = 7
const LOGO_ZOOM = 3.6
const square = (p: Point, h = 0.47) => [[p.x - h, p.y - h], [p.x + h, p.y - h], [p.x + h, p.y + h], [p.x - h, p.y + h]]
const VIEWS = new OrthographicView({ flipY: true })
const CONTROLLER = { inertia: 300 }
const FLY = {
  transitionDuration: 900,
  transitionInterpolator: new LinearInterpolator({ transitionProps: ['target', 'zoom'] }),
  transitionEasing: (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
}
type View = { target: [number, number, number]; zoom: number } & Partial<typeof FLY>
const cursor = ({ isHovering, isDragging }: { isHovering: boolean; isDragging: boolean }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')

interface Props {
  atlas: Atlas
  mode: AtlasMode
  colorBy: ColorBy
  selectedId: string
  visible: Set<string>
  hideSeen: boolean
  discovered: Set<string>
  // Similarity per startup from the last search; brightens the best matches.
  scores: Map<string, number> | null
  focusCluster: number | null
  flySeq: number
  onPick: (id: string) => void
  onCluster: (index: number) => void
}

export const AtlasView = memo(function AtlasView({ atlas, mode, colorBy, selectedId, visible, hideSeen, discovered, scores, focusCluster, flySeq, onPick, onCluster }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const points = mode === 'logos' ? atlas.logos : atlas.points
  const index = mode === 'logos' ? atlas.logoById : atlas.byId
  const bounds = useMemo(() => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    return { x0: Math.min(...xs) - 6, x1: Math.max(...xs) + 6, y0: Math.min(...ys) - 6, y1: Math.max(...ys) + 6 }
  }, [points])
  const [size, setSize] = useState({ w: 800, h: 600 })
  const fit = (w: number, h: number): View => ({
    target: [(bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2, 0],
    zoom: Math.log2(Math.min(w / (bounds.x1 - bounds.x0), h / (bounds.y1 - bounds.y0))),
  })
  const [view, setView] = useState<View>(() => fit(800, 600))
  const [sigils, setSigils] = useState<Sigils | null>(null)
  useEffect(() => { SIGILS.then(setSigils) }, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const minZoom = Math.log2(Math.min(size.w / (bounds.x1 - bounds.x0), size.h / (bounds.y1 - bounds.y0))) - 0.3
  // New map or new size: start from the whole picture.
  useEffect(() => setView(fit(size.w, size.h)), [mode, size.w, size.h, bounds]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = index.get(selectedId)
  // Sail to the selection when asked (search pick, list click), not on every map click.
  useEffect(() => {
    if (selected) setView((v) => ({ ...v, ...FLY, target: [selected.x, selected.y, 0], zoom: Math.max(v.zoom, 3.4) }))
  }, [flySeq]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = focusCluster === null ? null : atlas.clusters[focusCluster]
    if (c && mode === 'meaning') setView((v) => ({ ...v, ...FLY, target: [c.x, c.y, 0], zoom: Math.max(v.zoom, 2.6) }))
  }, [focusCluster]) // eslint-disable-line react-hooks/exhaustive-deps

  const showLogos = view.zoom >= LOGO_ZOOM || mode === 'logos'
  const topScore = scores ? Math.max(...scores.values()) : 1
  const lowScore = scores ? Math.min(...scores.values()) : 0

  const tiles = useMemo(() => new PolygonLayer<Point>({
    id: `atlas-tiles-${mode}`,
    data: points,
    getPolygon: (p) => square(p),
    getFillColor: (p) => {
      const on = visible.has(p.id) && (focusCluster === null || p.cluster === focusCluster)
      const c = mode === 'logos' ? [226, 220, 204] as [number, number, number] : colorOf(colorBy, p, atlas.clusters)
      const dim = hideSeen && discovered.has(p.id) ? 0.35 : 1
      const sc = scores?.get(p.id)
      const boost = sc === undefined ? 1 : 0.55 + 0.45 * ((sc - lowScore) / Math.max(1e-6, topScore - lowScore))
      return [c[0] * dim * boost, c[1] * dim * boost, c[2] * dim * boost, on ? 255 : 34]
    },
    stroked: false,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 90],
    transitions: { getFillColor: 450 },
    updateTriggers: { getFillColor: [visible, colorBy, focusCluster, scores, hideSeen && discovered] },
    onClick: ({ object }) => object && onPick(object.id),
  }), [points, mode, visible, colorBy, focusCluster, scores, hideSeen, discovered, atlas.clusters, onPick, topScore, lowScore])

  const logoLayer = useMemo(() => new IconLayer<Point>({
    id: `atlas-logos-${mode}`,
    data: mode === 'logos' ? atlas.logos : atlas.points.filter((p) => atlas.logoById.has(p.id)),
    iconAtlas: atlas.sprite.url,
    iconMapping: atlas.sprite.mapping,
    textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
    getIcon: (p) => p.id,
    getPosition: (p) => [p.x, p.y],
    getSize: mode === 'logos' ? 0.86 : 0.7,
    sizeUnits: 'common',
    getColor: (p) => [255, 255, 255, visible.has(p.id) && (focusCluster === null || p.cluster === focusCluster) ? 255 : 40],
    visible: showLogos,
    updateTriggers: { getColor: [visible, focusCluster] },
  }), [atlas, mode, visible, focusCluster, showLogos])

  // Pixel sigils for startups without a usable logo, once tiles are big enough to read.
  const sigilLayer = useMemo(() => sigils && mode === 'meaning' && new IconLayer<Point>({
    id: 'atlas-sigils',
    data: atlas.points.filter((p) => !atlas.logoById.has(p.id) && sigils.mapping[p.id]),
    iconAtlas: sigils.atlas,
    iconMapping: sigils.mapping,
    textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
    getIcon: (p) => p.id,
    getPosition: (p) => [p.x, p.y],
    getSize: 0.7,
    sizeUnits: 'common',
    getColor: (p) => [255, 255, 255, visible.has(p.id) ? 230 : 30],
    visible: view.zoom >= 4.6,
    updateTriggers: { getColor: visible },
  }), [sigils, atlas, mode, visible, view.zoom >= 4.6]) // eslint-disable-line react-hooks/exhaustive-deps

  const selection = new PolygonLayer<Point>({
    id: 'atlas-selection',
    data: selected ? [selected] : [],
    getPolygon: (p) => square(p, 0.62),
    filled: false,
    stroked: true,
    getLineColor: [235, 200, 120, 255],
    getLineWidth: 0.12,
    lineWidthUnits: 'common',
    lineWidthMinPixels: 2,
  })

  // Theme names float over their region; they fade once tiles are readable.
  const labelOpacity = Math.min(1, Math.max(0, (4.6 - view.zoom) / 1.4))
  const labels = new TextLayer<Cluster>({
    id: 'atlas-labels',
    data: mode === 'meaning' ? atlas.clusters : [],
    getPosition: (c) => [c.x, c.y],
    getText: (c) => c.label,
    getColor: (c) => [...c.color.map((v) => Math.min(255, v + 40)), focusCluster === null || focusCluster === c.index ? 245 : 70] as [number, number, number, number],
    getSize: (c) => 2.2 + Math.sqrt(c.size) * 0.18,
    sizeUnits: 'common',
    sizeMinPixels: 11,
    sizeMaxPixels: 30,
    fontFamily: '"IM Fell English", Georgia, serif',
    fontSettings: { sdf: true },
    outlineWidth: 3,
    outlineColor: [10, 9, 9, 230],
    opacity: Math.max(labelOpacity, focusCluster !== null ? 0.9 : 0),
    pickable: true,
    onClick: ({ object }) => object && onCluster(object.index),
    updateTriggers: { getColor: focusCluster },
  })

  return (
    <div ref={box} className="deck-box">
      <DeckGL
        views={VIEWS}
        viewState={view}
        controller={CONTROLLER}
        onViewStateChange={({ viewState }) => {
          const v = viewState as View
          setView({ target: v.target, zoom: Math.min(MAX_ZOOM, Math.max(minZoom, v.zoom)) })
        }}
        layers={[tiles, logoLayer, sigilLayer, selection, labels]}
        getCursor={cursor}
        getTooltip={({ object, layer }) => {
          if (!object) return null
          if (layer?.id === 'atlas-labels') {
            const c = object as Cluster
            return { html: `<b>${c.label}</b><div>${c.size} startups · ${c.terms.slice(0, 5).join(', ')}</div><div>click to read this market</div>`, className: 'map-tip', style: {} }
          }
          const p = object as Point
          const s = BY_ID.get(p.id)?.startup
          if (!s) return null
          const sc = scores?.get(p.id)
          return {
            html: `<b>${s.name}</b><div>${atlas.clusters[p.cluster].label} · ${s.sector} · ${s.country}${s.founded ? ` · ${s.founded}` : ''}</div>${sc !== undefined ? `<div class="tip-score">match ${Math.round(sc * 100)}%</div>` : ''}`,
            className: 'map-tip', style: {},
          }
        }}
      />
    </div>
  )
})
