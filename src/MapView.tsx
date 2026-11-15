import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL } from '@deck.gl/react'
import { LinearInterpolator, OrthographicView } from '@deck.gl/core'
import { IconLayer, LineLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Tile } from './layout'
import { useClock, useVoyage } from './anim'
import { iconUrl } from './icons'
import { sigilUrl } from './Logo'
import { SIGILS, type Sigils } from './sigils'
import { BOUNDS, ISLANDS, PARTNER, SEA, TILES } from './world'

const MAX_ZOOM = 7.5
// Above this zoom every visible tile shows its startup's emblem, like zig-zag's covers.
const EMBLEM_ZOOM = 4.8
const THIS_YEAR = new Date().getFullYear()

const FLY = {
  transitionDuration: 1200,
  transitionInterpolator: new LinearInterpolator({ transitionProps: ['target', 'zoom'] }),
  transitionEasing: (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
}

const boatSvg = (flip: boolean) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 16 16' shape-rendering='crispEdges'><g ${flip ? "transform='translate(16 0) scale(-1 1)'" : ''}><rect x='7' y='1' width='1' height='10' fill='#ddd'/><path d='M8 2h1v1h1v1h1v1h1v1h1v1h1v2H8z' fill='#f4ead2'/><path d='M3 7h4v3H3z' fill='#e8c878'/><path d='M1 11h14v1h-1v1h-1v1H3v-1H2v-1H1z' fill='#8a5a3c'/><path d='M2 14h12v1H2z' fill='#5fa8c8'/></g></svg>`)}`
const BOAT = { right: { url: boatSvg(false), width: 64, height: 64, id: 'boat-r' }, left: { url: boatSvg(true), width: 64, height: 64, id: 'boat-l' } }
const SPRITE = {
  gem: { url: iconUrl('gem', '#f0a0d8'), width: 64, height: 64, id: 'gem' },
  coin: { url: iconUrl('coin', '#ebc878'), width: 64, height: 64, id: 'coin' },
  seed: { url: iconUrl('seed', '#7ee0a0'), width: 64, height: 64, id: 'seed' },
}
const STARTUP_TILES = TILES.filter((t) => t.startup)
const BARE_LAND = TILES.filter((t) => !t.startup)
const square = (t: Tile, h = 0.47) => [[t.x - h, t.y - h], [t.x + h, t.y - h], [t.x + h, t.y + h], [t.x - h, t.y + h]]

type View = { target: [number, number, number]; zoom: number } & Partial<typeof FLY>
// Built once: new objects here on every render make deck.gl reset its camera and controller.
const VIEWS = new OrthographicView({ flipY: true })
const CONTROLLER = { inertia: 300 }
const cursor = ({ isHovering, isDragging }: { isHovering: boolean; isDragging: boolean }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')

export interface FlyRequest { x: number; y: number; zoom?: number; seq: number }

// Keeps the camera inside the sea: no zooming out or panning past its edges.
function clamp(v: View, w: number, h: number): View {
  const worldW = BOUNDS.x1 - BOUNDS.x0
  const worldH = BOUNDS.y1 - BOUNDS.y0
  // Cover, not contain: the sea always fills the screen, never the void beyond it.
  const minZoom = Math.log2(Math.max(w / worldW, h / worldH))
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, v.zoom))
  const scale = 2 ** zoom
  const axis = (c: number, lo: number, hi: number, half: number) => (hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)))
  return {
    ...v,
    zoom,
    target: [axis(v.target[0], BOUNDS.x0, BOUNDS.x1, w / 2 / scale), axis(v.target[1], BOUNDS.y0, BOUNDS.y1, h / 2 / scale), 0],
  }
}

interface Props {
  tile: Tile
  visible: Set<string>
  hideSeen: boolean
  discovered: Set<string>
  gems: Set<string>
  fly: FlyRequest
  onPick: (id: string) => void
}

export const MapView = memo(function MapView({ tile, visible, hideSeen, discovered, gems, fly, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ target: [tile.x, tile.y, 0], zoom: 4.2 })
  // Smooth frames only while the boat sails; idle bobbing and glints need far fewer.
  const [sailing, setSailing] = useState(true)
  useEffect(() => {
    setSailing(true)
    const t = setTimeout(() => setSailing(false), 1800)
    return () => clearTimeout(t)
  }, [tile])
  const clock = useClock(sailing ? 30 : 8)
  const [sigils, setSigils] = useState<Sigils | null>(null)
  useEffect(() => { SIGILS.then(setSigils) }, [])
  const voyage = useVoyage([tile.x, tile.y], clock)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setView((v) => clamp({ ...v, ...FLY, target: [fly.x, fly.y, 0], zoom: fly.zoom ?? Math.max(v.zoom, 3.6) }, size.w, size.h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly.seq])

  useEffect(() => setView((v) => clamp(v, size.w, size.h)), [size])

  const zoomedIn = view.zoom >= 3
  const showEmblems = view.zoom >= EMBLEM_ZOOM

  const tilesLayer = useMemo(() => new PolygonLayer<Tile>({
    id: 'tiles',
    data: STARTUP_TILES,
    getPolygon: (t) => square(t),
    getFillColor: (t) => {
      const id = t.startup!.id
      const dim = hideSeen && discovered.has(id) ? 0.3 : 1
      return [t.color[0] * dim, t.color[1] * dim, t.color[2] * dim, visible.has(id) ? 255 : 45]
    },
    stroked: false,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 90],
    transitions: { getFillColor: 400 },
    // Selecting a startup must not recolour every tile: `discovered` only matters while dimming.
    updateTriggers: { getFillColor: [visible, hideSeen && discovered] },
    onClick: ({ object }) => object && onPick(object.startup!.id),
  }), [visible, hideSeen, hideSeen && discovered, onPick])

  // Bare land in the middle of a neck is scenery, so it does not react to the pointer.
  const bareLayer = useMemo(() => new PolygonLayer<Tile>({
    id: 'bare',
    data: BARE_LAND,
    getPolygon: (t) => square(t),
    getFillColor: (t) => [...t.color, 255],
    stroked: false,
  }), [])

  const selectionLayer = useMemo(() => new PolygonLayer<Tile>({
    id: 'selection',
    data: [tile],
    getPolygon: (t) => square(t, 0.56),
    filled: false,
    stroked: true,
    getLineColor: [235, 200, 120, 255],
    getLineWidth: 0.1,
    lineWidthUnits: 'common',
    lineWidthMinPixels: 2,
  }), [tile])

  // Labels name the islands from afar and get out of the way once you are close enough to read tiles.
  const labelOpacity = Math.round(Math.min(1, Math.max(0, (5.4 - view.zoom) / 1.2)) * 20) / 20
  const labelsLayer = useMemo(() => new TextLayer({
    id: 'labels',
    data: ISLANDS,
    getPosition: (i) => [i.cx, i.cy],
    getText: (i) => i.sector,
    getColor: [236, 170, 205, 235],
    // World units, so labels grow and shrink with the island like a map.
    getSize: (i) => Math.max(3, i.radius * 0.4),
    sizeUnits: 'common',
    sizeMinPixels: 10,
    sizeMaxPixels: 44,
    fontFamily: '"IM Fell English", Georgia, serif',
    fontSettings: { sdf: true },
    outlineWidth: 3,
    outlineColor: [10, 9, 9, 220],
    opacity: labelOpacity,
    visible: labelOpacity > 0,
  }), [labelOpacity])

  // One prebuilt atlas holds every emblem; the GPU culls what is off screen, so panning costs nothing.
  const emblemsLayer = useMemo(() => sigils && new IconLayer<Tile>({
    id: 'emblems',
    data: STARTUP_TILES,
    iconAtlas: sigils.atlas,
    iconMapping: sigils.mapping,
    // Nearest-neighbour keeps the pixel art crisp when zoomed in.
    textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
    getIcon: (t) => t.startup!.id,
    getPosition: (t) => [t.x, t.y],
    getSize: (t) => (t === tile ? 0 : 0.82),
    getColor: (t) => [255, 255, 255, visible.has(t.startup!.id) ? 255 : 40],
    sizeUnits: 'common',
    visible: showEmblems,
    updateTriggers: { getSize: tile, getColor: visible },
  }), [sigils, tile, showEmblems, visible])

  // The selected startup's emblem, drawn on its own so it shows at every zoom and before the atlas is ready.
  const selectedEmblem = useMemo(() => new IconLayer<Tile>({
    id: 'selected-emblem',
    data: [tile],
    getIcon: (t) => ({ url: sigilUrl(t.startup!.name, t.color), width: 70, height: 70, id: t.startup!.id }),
    getPosition: (t) => [t.x, t.y],
    getSize: 1.15,
    sizeUnits: 'common',
    sizeMinPixels: 6,
  }), [tile])

  const spritesLayer = useMemo(() => new IconLayer<Tile>({
    id: 'sprites',
    data: zoomedIn ? TILES.filter((t) => t.startup && t !== tile && (gems.has(t.startup.id) || t.startup.funding || (t.startup.founded ?? 0) >= THIS_YEAR - 2)) : [],
    getPosition: (t) => [t.x + 0.24, t.y - 0.24],
    getIcon: (t) => (gems.has(t.startup!.id) ? SPRITE.gem : t.startup!.funding ? SPRITE.coin : SPRITE.seed),
    getSize: 0.45,
    sizeUnits: 'common',
    updateTriggers: { getIcon: gems },
  }), [zoomedIn, gems, tile])

  // Only these change every frame: water glints, wake and boat.
  const layers = [
    new ScatterplotLayer<(typeof SEA)[number]>({
      id: 'sea',
      data: SEA,
      getPosition: (d) => d.p,
      getRadius: 0.12,
      radiusMinPixels: 0.6,
      getFillColor: (d) => [120, 170, 200, 25 + 70 * Math.sin(clock * d.speed + d.phase) ** 8],
      updateTriggers: { getFillColor: Math.floor(clock * 8) },
    }),
    bareLayer,
    tilesLayer,
    selectionLayer,
    emblemsLayer,
    selectedEmblem,
    spritesLayer,
    labelsLayer,
    // Thin fading line: one segment per wake point so the tail can fade out.
    new LineLayer<number>({
      id: 'wake',
      data: voyage.wake.slice(1).map((_, i) => i),
      getSourcePosition: (i) => voyage.wake[i],
      getTargetPosition: (i) => voyage.wake[i + 1],
      getColor: (i) => [215, 235, 245, 20 + (i / Math.max(1, voyage.wake.length)) * 200],
      getWidth: 1.5,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: voyage.wake, getTargetPosition: voyage.wake, getColor: voyage.wake.length },
    }),
    new IconLayer({
      id: 'boat',
      data: [0],
      // Bobs at anchor, steadier while under sail.
      getPosition: () => [voyage.pos[0], voyage.pos[1] - 1.15 + Math.sin(clock * 2.2) * (voyage.sailing ? 0.05 : 0.14)],
      getIcon: () => (voyage.heading < 0 ? BOAT.left : BOAT.right),
      getSize: 2.4,
      sizeUnits: 'common',
      sizeMinPixels: 22,
      sizeMaxPixels: 64,
      updateTriggers: { getPosition: clock, getIcon: voyage.heading },
    }),
  ]

  return (
    <div ref={box} className="deck-box">
      <DeckGL
        views={VIEWS}
        viewState={view}
        controller={CONTROLLER}
        // Drop the flight transition, or every scroll and drag would replay a 1.2s animation.
        onViewStateChange={({ viewState }) => {
          const v = viewState as View
          setView(clamp({ target: v.target, zoom: v.zoom }, size.w, size.h))
        }}
        layers={layers}
        getCursor={cursor}
        getTooltip={({ object }) => {
          const s = (object as Tile)?.startup
          return s ? { html: `<b>${s.name}</b><div>${s.sector}${PARTNER.has(s.id) ? ` ⇄ ${PARTNER.get(s.id)}` : ''} · ${s.country}${s.founded ? ` · ${s.founded}` : ''}</div>`, className: 'map-tip', style: {} } : null
        }}
      />
    </div>
  )
})
