// Client-side wrappers for the News Impact + Agent Alerts endpoints.
// All shape definitions here mirror the server's schemaVersion 1 contract.
// If the server shape changes, update both server.cjs and this file together.

export type NewsCategory =
  | 'macro'
  | 'sector'
  | 'company'
  | 'policy'
  | 'us_politics'
  | 'canada_macro'
  | 'trade_policy'
  | 'geopolitical';

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;        // ISO timestamp
  url: string | null;
  impactScore: number;        // 1–10
  category: NewsCategory;
  summary: string;            // one sentence
  affectedTickers: string[];
}

export interface NewsImpactResponse {
  schemaVersion: number;
  items: NewsItem[];
  generatedAt: string;
  note?: string;
  error?: string;
}

export interface InsiderFiling {
  ticker: string;
  insiderName: string;
  type: 'BUY' | 'SELL';
  amount: number;             // USD
  filedDate: string;          // YYYY-MM-DD
  accessionNo: string;
}

export interface AgentAlert {
  id: string;
  createdAt: string;
  bullets: string[];          // max 5
  sourceNewsIds: string[];
  sourceFilings: InsiderFiling[];
  watchlistSnapshot: string[];
}

export interface AlertsLatestResponse {
  schemaVersion: number;
  alert: AgentAlert | null;
  generatedAt: string;
  note?: string;
  error?: string;
}

export interface InsiderFilingsResponse {
  schemaVersion: number;
  filings: InsiderFiling[];
  generatedAt: string;
  error?: string;
}

// ── Query params ──────────────────────────────────────────────────────────────

export interface NewsImpactParams {
  minScore?: number;          // default 7; pass 1 to show all
  category?: NewsCategory | 'all';
  days?: number;              // 1–30, default 1
  all?: boolean;              // true = drop the minScore floor entirely
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function fetchNewsImpact(params: NewsImpactParams = {}): Promise<NewsImpactResponse> {
  const qs = new URLSearchParams();
  if (params.minScore !== undefined) qs.set('minScore', String(params.minScore));
  if (params.category && params.category !== 'all') qs.set('category', params.category);
  if (params.days !== undefined) qs.set('days', String(params.days));
  if (params.all) qs.set('all', '1');

  const res = await fetch(`/api/news/impact?${qs.toString()}`);
  if (!res.ok) throw new Error(`News impact fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchAlertsLatest(playerId?: string): Promise<AlertsLatestResponse> {
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`/api/alerts/latest${qs}`);
  if (!res.ok) throw new Error(`Alerts latest fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchInsiderFilings(days = 7): Promise<InsiderFilingsResponse> {
  const res = await fetch(`/api/alerts/insider-filings?days=${days}`);
  if (!res.ok) throw new Error(`Insider filings fetch failed: ${res.status}`);
  return res.json();
}
