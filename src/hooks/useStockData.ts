import { useQueries, useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { tmx, fetchYahooCandles } from '../api/tmx';
import type { OHLCVBar, TimeRange, Quote, CompanyProfile } from '../api/types';
import { subDays, subMonths, subYears, getUnixTime, format } from 'date-fns';
import { generateMockCandles, generateMockQuote, generateMockProfile } from '../utils/mockData';
import { isTSXTicker } from '../utils/marketHours';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFromDate(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case '1D':  return subDays(now, 1);
    case '1W':  return subDays(now, 7);
    case '1M':  return subMonths(now, 1);
    case '3M':  return subMonths(now, 3);
    case '1Y':  return subYears(now, 1);
    case 'ALL': return subYears(now, 5);
    default:    return subMonths(now, 3);
  }
}

function getFinnhubResolution(range: TimeRange): string {
  switch (range) {
    case '1D': return '5';
    case '1W': return '30';
    case '1M': return 'D';
    case '3M': return 'D';
    case '1Y': return 'W';
    case 'ALL': return 'M';
    default:   return 'D';
  }
}

/** Map our TimeRange to Yahoo Finance range + interval */
function getYahooParams(range: TimeRange): { range: string; interval: string } {
  switch (range) {
    case '1D':  return { range: '1d',  interval: '5m'  };
    case '1W':  return { range: '5d',  interval: '30m' };
    case '1M':  return { range: '1mo', interval: '1d'  };
    case '3M':  return { range: '3mo', interval: '1d'  };
    case '1Y':  return { range: '1y',  interval: '1wk' };
    case 'ALL': return { range: '5y',  interval: '1mo' };
    default:    return { range: '3mo', interval: '1d'  };
  }
}

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === '1';
const hasFinnhubKey = () => !!import.meta.env.VITE_FINNHUB_API_KEY;

// ─── Candles ──────────────────────────────────────────────────────────────────

export function useStockCandles(symbol: string, range: TimeRange) {
  return useQuery({
    queryKey: ['candles', symbol, range],
    queryFn: async (): Promise<OHLCVBar[]> => {
      // Demo mode (no API key) — return deterministic mock data
      if (DEMO_MODE) return generateMockCandles(symbol, range);

      // ── All stocks → Yahoo Finance (US + CA) ─────────────────────────────
      // Yahoo Finance supports all timeframes including intraday, no rate limits.
      // Finnhub free tier blocks most intraday resolutions — avoid it for candles.
      try {
        const { range: yahooRange, interval } = getYahooParams(range);
        const { bars } = await fetchYahooCandles(symbol, yahooRange as any, interval as any);
        return bars;
      } catch {
        return [];
      }
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export function useStockQuote(symbol: string) {
  return useQuery<Quote | undefined>(getStockQuoteQueryOptions(symbol));
}

function getStockQuoteQueryOptions(symbol: string) {
  return {
    queryKey: ['quote', symbol],
    queryFn: async (): Promise<Quote | undefined> => {
      if (DEMO_MODE) return generateMockQuote(symbol);

      // ── Canadian stocks → TMX (quote) + Yahoo Finance (day H/L) ─────────
      if (isTSXTicker(symbol)) {
        try {
          // Fetch TMX quote and Yahoo day quote in parallel
          const [q, yahooResult] = await Promise.allSettled([
            tmx.getQuote(symbol),
            fetchYahooCandles(symbol, '1d', '5m'),
          ]);

          const tmxQ = q.status === 'fulfilled' ? q.value : null;
          if (!tmxQ || !tmxQ.price) return undefined;

          const yDay = yahooResult.status === 'fulfilled' ? yahooResult.value.dayQuote : null;

          return {
            c:  tmxQ.price,
            d:  tmxQ.priceChange,
            dp: tmxQ.percentChange,
            o:  yDay?.open      || tmxQ.openPrice,
            h:  yDay?.dayHigh   || tmxQ.weeks52high,   // prefer Yahoo day H, fallback 52w
            l:  yDay?.dayLow    || tmxQ.weeks52low,    // prefer Yahoo day L, fallback 52w
            pc: yDay?.prevClose || tmxQ.prevClose,
            // extras for stat cards
            _volume:    yDay?.volume || tmxQ.volume,
            _marketCap: tmxQ.MarketCap,
            _exchange:  tmxQ.exchangeCode,
            _name:      tmxQ.name,
          };
        } catch {
          return undefined;
        }
      }

      // ── US stocks → Finnhub ───────────────────────────────────────────────
      if (!hasFinnhubKey()) return undefined;
      try {
        const data = await finnhub.getQuote(symbol);
        if (!data.c || data.c === 0) return undefined;
        return data;
      } catch {
        return undefined;
      }
    },
    enabled: !!symbol,
    staleTime: 2 * 60 * 1000,         // 2 min — quotes don't need sub-minute precision
    refetchInterval: 2 * 60 * 1000,   // refetch every 2 min instead of every 1 min
    refetchIntervalInBackground: false, // don't hammer APIs when tab is hidden
    refetchOnMount: false,             // use cached data if still fresh on re-mount
  } as const;
}

export function useStockQuotes(symbols: string[]) {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean).map((symbol) => symbol.toUpperCase()))];

  const results = useQueries({
    queries: uniqueSymbols.map((symbol) => getStockQuoteQueryOptions(symbol)),
  });

  const quoteMap = uniqueSymbols.reduce<Record<string, Quote | undefined>>((acc, symbol, index) => {
    acc[symbol] = results[index]?.data ?? undefined;
    return acc;
  }, {});

  return {
    quoteMap,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
  };
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useStockProfile(symbol: string) {
  return useQuery<CompanyProfile | undefined>({
    queryKey: ['profile', symbol],
    queryFn: async () => {
      if (DEMO_MODE) return generateMockProfile(symbol);

      // ── Canadian stocks → TMX ─────────────────────────────────────────────
      if (isTSXTicker(symbol)) {
        try {
          const q = await tmx.getQuote(symbol);
          if (!q || !q.name) return undefined;
          // Normalise to Finnhub profile shape
          return {
            name:                 q.name,
            exchange:             q.exchangeCode,    // "TSX"
            marketCapitalization: q.MarketCap / 1e6, // TMX returns raw $, Finnhub uses millions
            ticker:               q.symbol,
            currency:             'CAD',
          };
        } catch {
          return undefined;
        }
      }

      // ── US stocks → Finnhub ───────────────────────────────────────────────
      if (!hasFinnhubKey()) return undefined;
      try {
        const data = await finnhub.getProfile(symbol);
        if (!data.name || !data.marketCapitalization) return undefined;
        return data;
      } catch {
        return undefined;
      }
    },
    staleTime: 24 * 60 * 60 * 1000,
  });
}
