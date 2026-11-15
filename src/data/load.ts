import type { Provenance, Stage, Startup } from './types'
import { mockStartups } from './mock'
import { SECTOR_LABEL } from './sectors'

// Raw shape written by scripts/import-cala.mjs.
type Raw = Omit<Startup, 'stage' | 'sector'> & { sector: string }


const STAGES: Stage[] = ['Unknown', 'No rounds', 'Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+']
const byRounds: Stage[] = ['No rounds', 'Seed', 'Series A', 'Series B', 'Series C+']
export const stageOf = (rounds: number): Stage => byRounds[Math.min(rounds, 4)]
const CALA_STAGE: Record<string, Stage> = { PRE_SEED: 'Pre-seed', SEED: 'Seed', SERIES_A: 'Series A', SERIES_B: 'Series B' }
const stage = (s: Raw): Stage => {
  if (s.fundingStage) return CALA_STAGE[s.fundingStage] ?? (/^SERIES_[C-Z]/.test(s.fundingStage) ? 'Series C+' : 'Unknown')
  return s.rounds.length || s.sources?.length || s.investors.length ? stageOf(s.rounds.length) : 'Unknown'
}

const files = import.meta.glob<Raw[]>('./startups.json', { eager: true, import: 'default' })
const raw = files['./startups.json']

// The same company can come back from two sector queries; keep its first sighting.
const unique = (list: Raw[]) => {
  const seen = new Set<string>()
  return list.filter((s) => !seen.has(s.id) && !!seen.add(s.id))
}

export const STARTUPS: Startup[] = raw
  ? unique(raw).map((s) => ({ ...s, sector: SECTOR_LABEL[s.sector] ?? s.sector, stage: stage(s) }))
  : mockStartups()
export const IS_MOCK = !raw

const posFiles = import.meta.glob<Record<string, [number, number]>>('./positions.json', { eager: true, import: 'default' })
export const POSITIONS = posFiles['./positions.json'] ?? {}
export interface Summary { summary: string; sources: { title: string; uri: string }[]; model: string; grounded?: boolean }
// Lazy: summaries are the biggest file and only the panel needs them, so they load after first paint.
const sumFiles = import.meta.glob<Record<string, Summary>>('./summaries.json', { import: 'default' })
const provFiles = import.meta.glob<Provenance>('./prov.json', { import: 'default' })
export const loadProvenance = (): Promise<Provenance> => provFiles['./prov.json']?.() ?? Promise.resolve({})
export const loadSummaries = (): Promise<Record<string, Summary>> => sumFiles['./summaries.json']?.() ?? Promise.resolve({})
// Startup ids that also belong to another sector (scripts/embed.mjs); `to` is the raw Cala sector.
const bridgeFiles = import.meta.glob<{ id: string; to: string }[]>('./bridges.json', { eager: true, import: 'default' })
export const BRIDGE_LINKS = (bridgeFiles['./bridges.json'] ?? []).map((b) => ({ id: b.id, to: SECTOR_LABEL[b.to] ?? b.to }))
export const SECTORS = [...new Set(STARTUPS.map((s) => s.sector))].sort()
export { STAGES }
