// Client-side wrapper for the Ownership Filing Triage endpoint (13D/13G/13D-A/13G-A).
// Shape mirrors the server's schemaVersion 1 contract in server.cjs
// (see runOwnershipFilingTriageJob / GET /api/ownership-filings/triage).
// If the server shape changes, update both server.cjs and this file together.

export type InvestorType = 'activist' | 'passive_index' | 'strategic_acquirer' | 'other';

export interface OwnershipFilingLlmThesis {
  signal?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WATCH';
  conviction?: 'HIGH' | 'MEDIUM' | 'LOW';
  ownership?: {
    currentStake?: string;
    shareCount?: string;
    changeFromPrior?: string;
  };
  investorType?: string;
  statedIntent?: string;
  catalysts?: string[];
  risks?: string[];
  thesis?: string;
  keyQuote?: string;
}

export interface OwnershipFilingSignal {
  id: string;
  accession_no: string;
  symbol: string | null;
  subject_company: string;
  subject_cik: string | null;
  filer_name: string;
  form_type: string;
  filed_date: string;
  filing_url: string;

  investor_type: InvestorType | null;
  investor_type_confidence: number | null;
  board_or_strategic_intent: number | null;
  new_position: number | null;
  mechanical_crossing: number | null;
  materiality_score: number | null;
  materiality_confidence: number | null;

  escalated: boolean;
  llm_thesis: OwnershipFilingLlmThesis | null;
  llm_model: string | null;

  sector: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnershipFilingsTriageResponse {
  schemaVersion: number;
  signals: OwnershipFilingSignal[];
  generatedAt: string;
  error?: string;
}

export interface OwnershipFilingsTriageParams {
  minMateriality?: number;      // 0-3, default 0 (show everything scored)
  investorType?: InvestorType;
  days?: number;                 // default 14
  escalatedOnly?: boolean;
  limit?: number;
}

export async function fetchOwnershipFilingsTriage(
  params: OwnershipFilingsTriageParams = {}
): Promise<OwnershipFilingsTriageResponse> {
  const qs = new URLSearchParams();
  if (params.minMateriality !== undefined) qs.set('minMateriality', String(params.minMateriality));
  if (params.investorType) qs.set('investorType', params.investorType);
  if (params.days !== undefined) qs.set('days', String(params.days));
  if (params.escalatedOnly) qs.set('escalatedOnly', '1');
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const res = await fetch(`/api/ownership-filings/triage?${qs.toString()}`);
  if (!res.ok) throw new Error(`Ownership filings triage fetch failed: ${res.status}`);
  return res.json();
}
