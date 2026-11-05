// Client wrapper for the unified filing triage feed (GET /api/filings/feed).
// Shape mirrors the schemaVersion 2 contract in server.cjs; per-type `signals`
// keys are defined in filingTriage.cjs. Update all three together.

export type FilingType = 'ownership' | 'insider' | 'event';
export type PriorityTier = 'critical' | 'high' | 'medium' | 'low';

export interface FilingThesis {
  // 13D/13G (Groq QUANT_PROMPT)
  signal?: string;
  conviction?: string | number;
  thesis?: string;
  ownership?: { currentStake?: string };
  // Form 4 / 8-K (Claude)
  headline?: string;
  direction?: string;
  event_type?: string;
  why_it_matters?: string;
  key_facts?: string[];
  context_flags?: string[];
  risks_or_unknowns?: string[];
  what_to_check_next?: string[];
}

export interface FilingSignal {
  id: string;
  accession_no: string;
  filing_type: FilingType;
  form_type: string;
  symbol: string | null;
  subject_company: string;
  filer_name: string;
  filed_date: string;
  filing_url: string;
  priority: number;
  priority_tier: PriorityTier;
  materiality_score: number | null;
  materiality_confidence: number | null;
  signals: Record<string, string | number | boolean | null>;
  escalated: boolean;
  llm_thesis: FilingThesis | null;
  llm_model: string | null;
  sector: string | null;
}

export interface FilingsFeedResponse {
  schemaVersion: number;
  triageMode?: 'rules' | 'hybrid' | 'jev';
  classifier?: 'jev' | 'llm' | 'none';
  signals: FilingSignal[];
  generatedAt: string;
  error?: string;
}

export interface FilingsFeedParams {
  types?: FilingType[];
  minPriority?: number;
  tier?: PriorityTier;
  days?: number;
  escalatedOnly?: boolean;
  symbols?: string[];
  limit?: number;
}

export async function fetchFilingsFeed(params: FilingsFeedParams = {}): Promise<FilingsFeedResponse> {
  const qs = new URLSearchParams();
  if (params.types?.length) qs.set('types', params.types.join(','));
  if (params.minPriority) qs.set('minPriority', String(params.minPriority));
  if (params.tier) qs.set('tier', params.tier);
  if (params.days !== undefined) qs.set('days', String(params.days));
  if (params.escalatedOnly) qs.set('escalatedOnly', '1');
  if (params.symbols?.length) qs.set('symbols', params.symbols.join(','));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const res = await fetch(`/api/filings/feed?${qs.toString()}`);
  if (!res.ok) throw new Error(`Filings feed fetch failed: ${res.status}`);
  return res.json();
}
