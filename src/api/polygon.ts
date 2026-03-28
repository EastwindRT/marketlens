const BASE = 'https://api.polygon.io';
const KEY = import.meta.env.VITE_POLYGON_API_KEY || '';

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon API error: ${res.status}`);
  return res.json();
}

export const polygon = {
  getAggregates: (ticker: string, from: string, to: string, multiplier = 1, timespan = 'day') =>
    request<any>(
      `${BASE}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${KEY}`
    ),

  getTickerDetails: (ticker: string) =>
    request<any>(`${BASE}/v3/reference/tickers/${ticker}?apiKey=${KEY}`),

  getPreviousClose: (ticker: string) =>
    request<any>(`${BASE}/v2/aggs/ticker/${ticker}/prev?apiKey=${KEY}`),
};
