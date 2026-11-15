export type Stage = 'Unknown' | 'No rounds' | 'Pre-seed' | 'Seed' | 'Series A' | 'Series B' | 'Series C+'

export interface Ref { id: string; name: string }

// Strongest source behind a fact; rank is Cala's FILING | PRIMARY | PRESS | AGGREGATOR.
// Loaded lazily from data/prov.json, keyed by startup id then Cala property name.
export interface Source { name: string; url: string; date: string | null; rank: string | null }
export type Provenance = Record<string, Record<string, Source>>

export interface Startup {
  id: string
  name: string
  sector: string
  country: string
  founded: number | null
  // Cala's funding_stage when known, else derived from the number of rounds.
  stage: Stage
  website: string | null
  description: string
  hq: string | null
  // Free-text amount from Cala search results, e.g. "~$41M".
  funding?: string | null
  fundingStage?: string | null
  totalFunding?: { value: number; units: string } | null
  headcount?: string | null
  status?: string | null
  slush?: boolean
  rounds: { id: string; name?: string; date: string | null }[]
  investors: Ref[]
  founders: Ref[]
  ceo?: Ref[]
  sources?: string[]
}
