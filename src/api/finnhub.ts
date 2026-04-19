import type { FinnhubCandleResponse, Quote, InsiderTransaction, CompanyProfile, SearchResult, NewsItem, AnalystRecommendation, PriceTarget, EarningsSurprise } from './types';

const BASE = 'https://finnhub.io/api/v1';
const KEY = import.meta.env.VITE_FINNHUB_API_KEY || '';

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const json = await res.json();
  // Finnhub returns 200 with {"error":"..."} for paywalled resources
  if (json && json.error) throw new Error(json.error);
  return json as T;
}

export const finnhub = {
  getCandles: (symbol: string, from: number, to: number, resolution = 'D') =>
    request<FinnhubCandleResponse>(
      `${BASE}/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}&token=${KEY}`
    ),

  getQuote: (symbol: string) =>
    request<Quote>(`${BASE}/quote?symbol=${symbol}&token=${KEY}`),

  // from/to are optional ISO date strings e.g. "2023-01-01"
  getInsiderTransactions: (symbol: string, from?: string, to?: string) => {
    let url = `${BASE}/stock/insider-transactions?symbol=${symbol}&token=${KEY}`;
    if (from) url += `&from=${from}`;
    if (to)   url += `&to=${to}`;
    return request<{ data: InsiderTransaction[] }>(url);
  },

  getProfile: (symbol: string) =>
    request<CompanyProfile>(`${BASE}/stock/profile2?symbol=${symbol}&token=${KEY}`),

  search: (query: string) =>
    request<{ result: SearchResult[] }>(`${BASE}/search?q=${query}&token=${KEY}`),

  getCompanyNews: (symbol: string, from: string, to: string) =>
    request<NewsItem[]>(
      `${BASE}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${KEY}`
    ),

  getRecommendations: (symbol: string) =>
    request<AnalystRecommendation[]>(
      `${BASE}/stock/recommendation?symbol=${symbol}&token=${KEY}`
    ),

  getPriceTarget: (symbol: string) =>
    request<PriceTarget>(
      `${BASE}/stock/price-target?symbol=${symbol}&token=${KEY}`
    ),

  getEarnings: (symbol: string) =>
    request<EarningsSurprise[]>(
      `${BASE}/stock/earnings?symbol=${symbol}&token=${KEY}`
    ),

  getMarketNews: (category: 'general' | 'merger' = 'general') =>
    request<NewsItem[]>(`${BASE}/news?category=${category}&token=${KEY}`),

  // Basic financials — P/E, 52W high/low, margins, growth, ROE etc.
  getBasicFinancials: (symbol: string) =>
    request<{ metric?: Record<string, number>; series?: Record<string, unknown> }>(
      `${BASE}/stock/metric?symbol=${symbol}&metric=all&token=${KEY}`
    ),

  // Upcoming earnings calendar for a single symbol
  getEarningsCalendar: (symbol: string, from: string, to: string) =>
    request<{ earningsCalendar?: Array<{ date: string; symbol: string; epsEstimate?: number; revenueEstimate?: number; hour?: string }> }>(
      `${BASE}/calendar/earnings?symbol=${symbol}&from=${from}&to=${to}&token=${KEY}`
    ),

  getPeers: (symbol: string) =>
    request<string[]>(`${BASE}/stock/peers?symbol=${symbol}&token=${KEY}`),
};

export function formatTickerForFinnhub(ticker: string, exchange?: string): string {
  if (exchange === 'TSX' || ticker.endsWith('.TO')) return ticker.includes('.') ? ticker : `${ticker}.TO`;
  return ticker;
}
