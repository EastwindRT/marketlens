export interface XTrendItem {
  symbol: string;
  mentions: number;
  previousMentions: number;
  mentionChange: number;
  mentionChangePct: number | null;
  trajectory?: SocialTrendTrajectory;
  uniqueAccounts: number;
  engagementScore: number;
  latestPostAt: string | null;
}

export interface SocialTrendTrajectory {
  history: Array<{ date: string; mentions: number }>;
  mentionChange1d: number | null;
  mentionChangePct1d: number | null;
  mentionChange3d: number | null;
  mentionChangePct3d: number | null;
  trendStreakDays: number;
  slope: number;
  acceleration: number | null;
  trendState: 'building' | 'accelerating' | 'growing' | 'steady' | 'fading' | string;
}

export interface XTrendsResponse {
  schemaVersion: number;
  generatedAt: string;
  hours: number;
  source: string;
  results: XTrendItem[];
  note?: string;
  error?: string;
}

export interface XTrendsParams {
  hours?: number;
  limit?: number;
}

export async function fetchXTrends(params: XTrendsParams = {}): Promise<XTrendsResponse> {
  const qs = new URLSearchParams();
  if (params.hours) qs.set('hours', String(params.hours));
  if (params.limit) qs.set('limit', String(params.limit));

  const res = await fetch(`/api/x-social/trends?${qs.toString()}`);
  if (!res.ok) throw new Error(`X trends fetch failed: ${res.status}`);
  return res.json();
}
