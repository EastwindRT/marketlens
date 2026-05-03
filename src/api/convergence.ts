export interface ConvergenceSignalCell {
  score: number;
  label: string;
  detail: string;
}

export interface ConvergenceSource {
  type: string;
  title: string;
  source?: string;
  url?: string | null;
  publishedAt?: string;
  filedDate?: string;
  score?: number;
  amount?: number;
}

export interface ConvergenceRow {
  symbol: string;
  companyName: string;
  convergenceScore: number;
  summary: string;
  reasons: string[];
  conflicts: string[];
  sourceCount: number;
  updatedAt: string | null;
  signals: {
    price: ConvergenceSignalCell;
    news: ConvergenceSignalCell;
    reddit: ConvergenceSignalCell;
    x: ConvergenceSignalCell;
    insider: ConvergenceSignalCell;
    congress: ConvergenceSignalCell;
    funds: ConvergenceSignalCell;
    ownershipFilings: ConvergenceSignalCell;
  };
  sources: ConvergenceSource[];
  links: Record<string, string>;
}

export interface ConvergenceDashboardResponse {
  schemaVersion: number;
  generatedAt: string;
  rows: ConvergenceRow[];
  note?: string;
  error?: string;
  agent?: {
    summaryEndpoint: string;
    tickerContextEndpoint: string;
    llms: string;
  };
}

export async function fetchConvergenceDashboard(limit = 60): Promise<ConvergenceDashboardResponse> {
  const res = await fetch(`/api/convergence-dashboard?limit=${limit}`);
  if (!res.ok) throw new Error(`Convergence dashboard fetch failed: ${res.status}`);
  return res.json();
}
