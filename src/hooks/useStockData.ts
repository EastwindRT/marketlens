import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { tmx, fetchYahooCandles } from '../api/tmx';
import type { OHLCVBar, TimeRange } from '../api/types';
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

const hasApiKey = () => !!import.meta.env.VITE_FINNHUB_API_KEY;

// ─── Candles ──────────────────────────────────────────────────────────────────

export function useStockCandles(symbol: string, range: TimeRange) {
  return useQuery({
    queryKey: ['candles', symbol, range],
    queryFn: async (): Promise<OHLCVBar[]> => {
      // Demo mode (no API key) — return deterministic mock data
      if (!hasApiKey()) return generateMockCandles(symbol, range);

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
  return useQuery({
    queryKey: ['quote', symbol],
    queryFn: async () => {
      if (!hasApiKey()) return generateMockQuote(symbol);

      // ── Canadian stocks → TMX (quote) + Yahoo Finance (day H/L) ─────────
      if (isTSXTicker(symbol)) {
        try {
          // Fetch TMX quote and Yahoo day quote in parallel
          const [q, yahooResult] = await Promise.allSettled([
            tmx.getQuote(symbol),
            fetchYahooCandles(symbol, '1d', '5m'),
          ]);

          const tmxQ = q.status === 'fulfilled' ? q.value : null;
          if (!tmxQ || !tmxQ.price) return generateMockQuote(symbol);

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
          return generateMockQuote(symbol);
        }
      }

      // ── US stocks → Finnhub ───────────────────────────────────────────────
      try {
        const data = await finnhub.getQuote(symbol);
        if (!data.c || data.c === 0) return generateMockQuote(symbol);
        return data;
      } catch {
        return generateMockQuote(symbol);
      }
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useStockProfile(symbol: string) {
  return useQuery({
    queryKey: ['profile', symbol],
    queryFn: async () => {
      if (!hasApiKey()) return generateMockProfile(symbol);

      // ── Canadian stocks → TMX ─────────────────────────────────────────────
      if (isTSXTicker(symbol)) {
        try {
          const q = await tmx.getQuote(symbol);
          if (!q || !q.name) return generateMockProfile(symbol);
          // Normalise to Finnhub profile shape
          return {
            name:                 q.name,
            exchange:             q.exchangeCode,    // "TSX"
            marketCapitalization: q.MarketCap / 1e6, // TMX returns raw $, Finnhub uses millions
            ticker:               q.symbol,
            currency:             'CAD',
          };
        } catch {
          return generateMockProfile(symbol);
        }
      }

      // ── US stocks → Finnhub ───────────────────────────────────────────────
      try {
        const data = await finnhub.getProfile(symbol);
        if (!data.name || !data.marketCapitalization) return generateMockProfile(symbol);
        return data;
      } catch {
        return generateMockProfile(symbol);
      }
    },
    staleTime: 24 * 60 * 60 * 1000,
  });
}
