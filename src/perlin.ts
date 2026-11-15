import { rng } from './data/mock'

// Classic 2D Perlin noise with a seeded permutation table.
export function perlin(seed: number) {
  const r = rng(seed)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = [...p, ...p]
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a: number, b: number, t: number) => a + t * (b - a)
  const grad = (h: number, x: number, y: number) => (h & 1 ? -x : x) + (h & 2 ? -y : y)
  const noise = (x: number, y: number) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    const u = fade(x)
    const v = fade(y)
    const a = perm[X] + Y
    const b = perm[X + 1] + Y
    return lerp(
      lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u),
      v,
    )
  }
  // Fractal sum: big bays from the first octave, ragged coast from the rest.
  return (x: number, y: number, octaves = 4) => {
    let sum = 0
    let amp = 1
    let freq = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }
}
