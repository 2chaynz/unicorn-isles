// 16-bit style sprites drawn as pixel grids: one char per pixel, '.' transparent.
type Art = { rows: string[]; colors: Record<string, string> }

function svg({ rows, colors }: Art, scale = 4) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length))
  const rects = rows.flatMap((row, y) => [...row].map((c, x) => (colors[c] ? `<rect x='${x}' y='${y}' width='1.02' height='1.02' fill='${colors[c]}'/>` : ''))).join('')
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w * scale}' height='${h * scale}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${rects}</svg>`)}`,
    width: w * scale, height: h * scale,
  }
}
const sprite = (id: string, art: Art) => ({ id, ...svg(art) })

const SERPENT = sprite('serpent', {
  colors: { g: '#3fb3a0', d: '#2a7f74', y: '#ffd166', w: '#ffffff', k: '#1d3557', b: '#b9ab8c' },
  rows: [
    '..........gg..............',
    '.........gggg.............',
    '........ggwkg.............',
    '........gggggy............',
    '.........gggyy............',
    '....gg....gg.......gg.....',
    '...gddg...gg......gddg....',
    '..gd..dg..dg.....gd..dg...',
    '.gd....dggdg....gd....dg..',
    '...bbb..bbb..bbb..bbb.....',
    '......bb....bb....bb......',
  ],
})
const WHALE = sprite('whale', {
  colors: { b: '#5b8def', d: '#3c63b8', l: '#cfe3ff', k: '#1d3557', w: '#ffffff', s: '#b9ab8c' },
  rows: [
    '.......s..s.........',
    '........ss..........',
    '.........s..........',
    '.....bbbbbbbb.......',
    '...bbbbbbbbbbbb...dd',
    '..bbkbbbbbbbbbbbbdd.',
    '.bbbbbbbbbbbbbbbbd..',
    '.bllllllllbbbbbbb...',
    '..lllllllllbbbb.....',
    '...sss..sss..sss....',
    '......ss....ss......',
  ],
})
const KRAKEN = sprite('kraken', {
  colors: { p: '#e76f9a', d: '#b84a75', w: '#ffffff', k: '#1d3557', s: '#b9ab8c' },
  rows: [
    '......pppp......',
    '.....pppppp.....',
    '....pwkppwkp....',
    '....pppppppp....',
    '.p...pppppp...p.',
    'pdp..pdppdp..pdp',
    '.pd.pd.pd.dp.dp.',
    '..pdp..pd..pdp..',
    '...sss..sss.....',
    '......ss........',
  ],
})
// Iku-Turso: the Finnish sea monster of the Kalevala, a many-armed beast rising from the deep.
const IKU_TURSO = sprite('iku-turso', {
  colors: { t: '#4f6b5a', d: '#33483c', e: '#ffd166', k: '#1d1d1d', s: '#b9ab8c', h: '#a3c3a0' },
  rows: [
    '.......tttttt.........',
    '.....tttttttttt.......',
    '....tthttttttthtt.....',
    '....ttekttttttektt....',
    '....tttttttttttttt....',
    '.....tttdddddttttt....',
    '.t....tttttttttt....t.',
    'tdt..tdt.tdt.tdt...tdt',
    '.td.td..td..td.td.td..',
    '..tdt...tdt..tdt..dt..',
    '...t.....t....t...t...',
    '...sss..sss..sss..s...',
    '......ss....ss........',
  ],
})
// The Swan of Tuonela: the black swan gliding on the river of the underworld.
const TUONELA_SWAN = sprite('tuonela-swan', {
  colors: { b: '#2b2b33', g: '#4a4a55', r: '#c0392b', s: '#b9ab8c', w: '#e9e4d8' },
  rows: [
    '..bb..............',
    '.bbbr.............',
    '.bb...............',
    '..b...............',
    '..b...............',
    '..bb.......bbb....',
    '...bb...bbbgbbbb..',
    '...bbbbbbbgggbbbbb',
    '....bbbbbbbbbbbbb.',
    '.....bbbbbbbbbbb..',
    '...sss..sss..ss...',
    '......ss..........',
  ],
})
// Näkki (vetehinen): the water spirit of Finnish lakes, peering out with weed for hair.
const NAKKI = sprite('nakki', {
  colors: { h: '#5f8f4e', d: '#3e6233', f: '#c9d6b0', e: '#e8f0ff', k: '#1d1d1d', s: '#b9ab8c' },
  rows: [
    '...h.hh.h.h...',
    '..hhhhhhhhhh..',
    '.hhdhhhhhhdhh.',
    '.hhffffffffhh.',
    'hhfekffffekfhh',
    'hhffffffffffhh',
    'hd.ffkkkkff.dh',
    'h...ffffff...h',
    '...sss..sss...',
    '......ss......',
  ],
})
// Jörmungandr: the Norse world serpent that circles the sea.
const JORMUNGANDR = sprite('jormungandr', {
  colors: { g: '#6d7f3f', d: '#4b5a2a', y: '#e2c044', k: '#1d1d1d', s: '#b9ab8c', w: '#ffffff' },
  rows: [
    '...ggg................gg..',
    '..gyykg..............gddg.',
    '..gggggg....ggg.....gd..dg',
    '.....gdg...gdddg...gd....g',
    '......gdg.gd...dg.gd......',
    '.......gdgd.....dgd.......',
    '...sss..sss..sss..sss.....',
    '......ss....ss....ss......',
  ],
})

// Creatures of the chart; the Nordic ones carry a line of their myth for the tooltip.
export const CREATURES = [
  { ...IKU_TURSO, name: 'Iku-Turso', myth: 'Sea monster of the Finnish Kalevala, born of the ocean.' },
  { ...TUONELA_SWAN, name: 'Swan of Tuonela', myth: 'Glides on the black river of the Finnish underworld.' },
  { ...NAKKI, name: 'Näkki', myth: 'Finnish water spirit that pulls the careless into the lake.' },
  { ...JORMUNGANDR, name: 'Jörmungandr', myth: 'Norse world serpent that circles the sea, tail in mouth.' },
  { ...WHALE, name: 'Whale', myth: 'Old mapmakers drew whales in every empty corner.' },
  { ...KRAKEN, name: 'Kraken', myth: 'Norwegian sea monster so huge that sailors mistook it for an island.' },
  { ...SERPENT, name: 'Sea serpent', myth: 'Reported off Norway for centuries; a bishop described one in 1746.' },
]
export type Creature = (typeof CREATURES)[number]

const boat = (flip: boolean) => sprite(flip ? 'boat-l' : 'boat-r', {
  colors: { m: '#3a2a1a', s: '#e4452f', r: '#ffd23f', h: '#2b3f66', d: '#1d2b47', w: '#9fd0d0' },
  rows: [
    '.......m........',
    '.......mr.......',
    '.......mrr......',
    '......smssss....',
    '.....ssmsssss...',
    '....sssmssssss..',
    '...ssssmsssssss.',
    '.......m........',
    'hhhhhhhhhhhhhhhh',
    '.hhhhhhhhhhhhhh.',
    '..dddddddddddd..',
    '.w.ww..w..ww.w..',
  ].map((r) => (flip ? [...r].reverse().join('') : r)),
})
export const BOAT_RIGHT = boat(false)
export const BOAT_LEFT = boat(true)

export const WAVE = sprite('wave', {
  colors: { w: '#9a8866' },
  rows: ['..ww....', '.w..w..w', 'w....ww.'],
})

export const COMPASS = sprite('compass', {
  colors: { r: '#ff6b6b', n: '#1d3557', g: '#c9a227', c: '#fff3d6' },
  rows: [
    '.......r.......',
    '......rrr......',
    '......rrr......',
    '...g..rnr..g...',
    '....g.cnc.g....',
    '.....gcncg.....',
    '.nnnnnnnnnnnnn.',
    'nnccccc.cccccnn',
    '.nnnnnnnnnnnnn.',
    '.....gcncg.....',
    '....g.cnc.g....',
    '...g..cnc..g...',
    '......ccc......',
    '......ccc......',
    '.......c.......',
  ],
})

// One land tile; deck.gl tints it per startup (mask mode), so a single texture draws every tile.
export const TILE = { id: 'tile', url: `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='#fff'/></svg>")}`, width: 16, height: 16, mask: true }
// Eino, the old Finnish fisherman who greets you: knitted cap, white beard, pipe, yellow oilskin.
// Drawn as the left half of each row and mirrored; the pipe and smoke are added on the right.
const EINO_HALF = [
  '............',
  '........nnnn',
  '......nnnnnn',
  '....nnnnnnnn',
  '...nnnnnnnnn',
  '..nnnnnnnnnn',
  '..NNNNNNNNNN',
  '..NNNNNNNNNN',
  '..ssssssssss',
  '..sswwwwssss',
  '..ssssksssss',
  '..sssssssssd',
  '..wwwwwwwwww',
  '..wwwwwwwwww',
  '..wwgwwwwwww',
  '...wwwwwwwww',
  '....wwwwwwww',
  '....wwwwwwww',
  '..yyyywwwwww',
  '.yyyyyyyyyyY',
  '.yyyyyyyyyyY',
  '.yyYyyyyyyyY',
  '.yyyyyyyyyyY',
]
const EINO_ROWS = EINO_HALF.map((half) => [...(half + [...half].reverse().join(''))])
const poke = (r: number, c: number, ch: string) => { EINO_ROWS[r][c] = ch }
for (let c = 14; c <= 18; c++) poke(12, c, 'p')
for (const [r, c] of [[10, 19], [10, 20], [11, 19], [11, 20], [12, 19], [12, 20]]) poke(r, c, 'P')
for (const [r, c] of [[8, 20], [7, 21], [6, 20]]) poke(r, c, 'g')
export const FISHERMAN = svg({
  rows: EINO_ROWS.map((r) => r.join('')),
  colors: { n: '#2f4a7a', N: '#4a6aa0', s: '#e3b48a', d: '#c08a62', k: '#1d1d1d', w: '#f2efe6', g: '#c9c5b8', y: '#e0b43a', Y: '#b88a22', p: '#7a5230', P: '#4a3220' },
}, 6)

// Round node for startups shown with their logo.
export const DISC ={ id: 'disc', url: `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><circle cx='32' cy='32' r='31' fill='#fff'/></svg>")}`, width: 64, height: 64, mask: true }
