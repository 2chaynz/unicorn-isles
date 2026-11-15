import type { Startup } from './types'

// Fictional data, used only when src/data/startups.json has not been imported yet.
const SECTORS = ['FinTech', 'HealthTech', 'ClimateTech', 'AI', 'Robotics', 'Gaming', 'Mobility', 'FoodTech']
const COUNTRIES = ['Finland', 'Sweden', 'Estonia', 'Denmark', 'Norway']
const STAGES = ['No rounds', 'Seed', 'Series A', 'Series B', 'Series C+'] as const
const FUNDS = ['Northwind Ventures', 'Aurora Capital', 'Fjord Partners', 'Baltic Seed', 'Polar Fund', 'Kite Ventures']
const SYL = ['ka', 'lo', 'vi', 'nor', 'ta', 'ri', 'sol', 'mi', 'ux', 'pha', 'zen', 'qu']

export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)]

export function mockStartups(perSector = 100): Startup[] {
  const r = rng(42)
  const out: Startup[] = []
  for (const sector of SECTORS) {
    const count = Math.floor(perSector * (0.5 + r()))
    for (let i = 0; i < count; i++) {
      const n = Math.min(4, Math.floor(r() * r() * 5))
      const s = Array.from({ length: 2 + Math.floor(r() * 2) }, () => pick(r, SYL)).join('')
      const name = s[0].toUpperCase() + s.slice(1)
      const founded = 2015 + Math.floor(r() * 10)
      out.push({
        id: `mock-${out.length}`,
        name,
        sector,
        country: pick(r, COUNTRIES),
        founded,
        stage: STAGES[n],
        website: `${name.toLowerCase()}.example`,
        description: `${name} builds ${sector.toLowerCase()} products for European ${pick(r, ['SMBs', 'hospitals', 'banks', 'cities'])}.`,
        hq: null,
        rounds: Array.from({ length: n }, (_, k) => ({ id: `r${k}`, date: `${founded + k + 1}-01-01` })),
        investors: [...new Set([pick(r, FUNDS), pick(r, FUNDS)])].map((f) => ({ id: f, name: f })),
        founders: [],
        sources: [],
      })
    }
  }
  return out
}
