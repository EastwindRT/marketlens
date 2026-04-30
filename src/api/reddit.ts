export type RedditTrendFilter =
  | 'all'
  | 'all-stocks'
  | 'all-crypto'
  | 'stocks'
  | 'wallstreetbets'
  | 'options'
  | 'investing'
  | 'Daytrading'
  | 'SPACs';

export interface RedditTrendItem {
  rank: number;
  ticker: string;
  name: string;
  mentions: number;
  upvotes: number;
  rank24hAgo: number | null;
  mentions24hAgo: number | null;
  mentionChange: number | null;
  mentionChangePct: number | null;
  velocityScore: number;
  price: {
    last: number | null;
    changePct1d: number | null;
    changePct5d: number | null;
  };
  latestNews: {
    headline: string;
    source: string;
    publishedAt: string;
    impactScore: number | null;
    url: string | null;
  } | null;
  buyPressure: {
    net: 'buy' | 'sell' | 'mixed' | 'none';
    buyValue: number;
    sellValue: number;
    tradeCount: number;
  };
}

export interface RedditTrendsResponse {
  schemaVersion: number;
  filter: string;
  count: number;
  pages: number;
  currentPage: number;
  generatedAt: string;
  source: string;
  results: RedditTrendItem[];
  note?: string;
  error?: string;
}

export interface RedditTrendsParams {
  filter?: RedditTrendFilter;
  page?: number;
  limit?: number;
}

export async function fetchRedditTrends(params: RedditTrendsParams = {}): Promise<RedditTrendsResponse> {
  const qs = new URLSearchParams();
  if (params.filter) qs.set('filter', params.filter);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));

  const res = await fetch(`/api/reddit-trends?${qs.toString()}`);
  if (!res.ok) throw new Error(`Reddit trends fetch failed: ${res.status}`);
  return res.json();
}
