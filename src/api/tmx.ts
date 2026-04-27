/**
 * TMX Money GraphQL API  (quotes, market cap, insider/SEDI data)
 * Yahoo Finance Chart API (historical OHLCV candles for Canadian stocks)
 *
 * Source: app-money.tmx.com/graphql + query1.finance.yahoo.com
 * No API key required for either — public endpoints used by their own websites.
 */

// In dev, requests go through Vite proxy at /api/tmx → app-money.tmx.com
// Proxy handles Origin/Referer headers, bypassing CORS restrictions from localhost
const TMX_GQL = '/api/tmx/graphql';

const TMX_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(TMX_GQL, {
    method: 'POST',
    headers: TMX_HEADERS,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`TMX API error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? 'TMX GraphQL error');
  return json.data as T;
}

/** Raw SEDI transaction from TMX */
export interface TMXInsiderTransaction {
  date: string;
  datefrom: string;
  filingdate: string;
  filer: string;              // insider name  e.g. "McKibbon, Terrance Lloyd"
  relationship: string;       // role          e.g. "Director of Issuer"
  transactionTypeCode: number; // 1 = Acquisition (BUY), 2 = Disposition (SELL)
  amount: number;             // shares
  pricefrom: number;          // price per share
  marketvalue: number;        // total value
  pricefromcurrency: string;  // "CAD"
  securitydesignation: string;
  amountowned: number;
  type: string;               // human-readable description
  transactionid: number;
  form: string;               // "sedi"
  generalremarks: string;
}

export const tmx = {
  /**
   * Fetch insider transactions for a TSX-listed stock.
   * @param symbol  Base ticker without exchange suffix e.g. "BDT" not "BDT.TO"
   */
  getInsiderTransactions: async (symbol: string): Promise<TMXInsiderTransaction[]> => {
    const ticker = symbol.replace(/\.(TO|TSX|V|TSXV)$/i, '').toUpperCase();
    const data = await gql<{ getInsiderTransactions: TMXInsiderTransaction[] }>(
      `{ getInsiderTransactions(symbol: "${ticker}") }`
    );
    return Array.isArray(data.getInsiderTransactions) ? data.getInsiderTransactions : [];
  },

  /**
   * Fetch quote + profile data for a TSX-listed stock.
   * Returns normalised shape compatible with Finnhub quote + profile.
   */
  getQuote: async (symbol: string) => {
    const ticker = symbol.replace(/\.(TO|TSX|V|TSXV)$/i, '').toUpperCase();
    const data = await gql<{ getQuoteBySymbol: TMXQuote }>(
      `{ getQuoteBySymbol(symbol: "${ticker}", locale: "en") {
          symbol name price priceChange percentChange prevClose openPrice
          exchangeCode exchangeName MarketCap volume weeks52high weeks52low
      } }`
    );
    return data.getQuoteBySymbol;
  },
};

/** TMX quote shape (GraphQL response) */
export interface TMXQuote {
  symbol: string;
  name: string;
  price: number;
  priceChange: number;
  percentChange: number;
  prevClose: number;
  openPrice: number;
  exchangeCode: string;
  exchangeName: string;
  MarketCap: number;       // note: capital M — TMX uses this casing
  volume: number;
  weeks52high: number;
  weeks52low: number;
}

// ─── Yahoo Finance chart API ──────────────────────────────────────────────────

type YahooRange = '1d' | '5d' | '1mo' | '3mo' | '1y' | '5y' | 'max';
type YahooInterval = '1m' | '5m' | '30m' | '1d' | '1wk' | '1mo';

export interface OHLCVBar {
  time: string;   // 'YYYY-MM-DD' for daily+, ISO string for intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Day-level quote fields extracted from Yahoo Finance chart meta */
export interface YahooDayQuote {
  dayHigh: number;
  dayLow: number;
  open: number;
  prevClose: number;
  volume: number;
}

/**
 * Fetch OHLCV candles from Yahoo Finance for a Canadian stock.
 * Also returns day-level quote meta (dayHigh, dayLow, volume, open, prevClose).
 * @param symbol   Full ticker with suffix e.g. "DXT.TO"
 * @param range    Yahoo range string e.g. "3mo"
 * @param interval Yahoo interval string e.g. "1d"
 */
export async function fetchYahooCandles(
  symbol: string,
  range: YahooRange,
  interval: YahooInterval
): Promise<{ bars: OHLCVBar[]; dayQuote: YahooDayQuote | null }> {
  // Use Vite proxy path → /api/yahoo → query1.finance.yahoo.com (bypasses CORS)
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo Finance');

  // Extract day-level quote from chart meta
  const meta = result.meta ?? {};
  const dayQuote: YahooDayQuote | null = meta.regularMarketPrice ? {
    dayHigh:   meta.regularMarketDayHigh   ?? 0,
    dayLow:    meta.regularMarketDayLow    ?? 0,
    open:      meta.regularMarketOpen      ?? 0,
    prevClose: meta.regularMarketPreviousClose ?? 0,
    volume:    meta.regularMarketVolume    ?? 0,
  } : null;

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const opens: number[]   = q.open   ?? [];
  const highs: number[]   = q.high   ?? [];
  const lows: number[]    = q.low    ?? [];
  const closes: number[]  = q.close  ?? [];
  const volumes: number[] = q.volume ?? [];

  const isIntraday = interval === '1m' || interval === '5m' || interval === '30m';

  const bars = timestamps
    .map((ts, i) => {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
      if (o == null || h == null || l == null || c == null) return null;
      const date = new Date(ts * 1000);
      return {
        time: isIntraday
          ? date.toISOString()
          : date.toISOString().slice(0, 10),
        open: o, high: h, low: l, close: c, volume: v ?? 0,
      };
    })
    .filter((b): b is OHLCVBar => b !== null);

  return { bars, dayQuote };
}
