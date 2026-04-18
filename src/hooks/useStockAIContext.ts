import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { isTSXTicker } from '../utils/marketHours';

/**
 * Fundamentals + analyst context for the Ask AI chat.
 * Fetches in parallel and returns a single flat object the server can format.
 * Only runs for US stocks — Finnhub fundamentals aren't reliable for TSX tickers.
 */
export interface StockAIFundamentals {
  // Valuation
  peRatio?: number;
  pegRatio?: number;
  psRatio?: number;
  epsTTM?: number;

  // Growth (YoY %)
  revenueGrowthYoy?: number;
  epsGrowthYoy?: number;

  // Margins (%)
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  roe?: number;

  // 52-week
  weeks52high?: number;
  weeks52low?: number;
  currentPrice?: number;

  // Analyst
  analystRec?: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  };
  priceTargetMean?: number;
  priceTargetHigh?: number;
  priceTargetLow?: number;

  // Upcoming earnings
  upcomingEarningsDate?: string;
}

export function useStockAIContext(symbol: string, enabled = true) {
  return useQuery<StockAIFundamentals | null>({
    queryKey: ['stock-ai-context', symbol],
    enabled: enabled && !!symbol && !isTSXTicker(symbol),
    staleTime: 60 * 60 * 1000, // 1 hour — fundamentals don't change often
    queryFn: async () => {
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const to = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [basicsRes, recRes, ptRes, earningsRes] = await Promise.allSettled([
        finnhub.getBasicFinancials(symbol),
        finnhub.getRecommendations(symbol),
        finnhub.getPriceTarget(symbol),
        finnhub.getEarningsCalendar(symbol, from, to),
      ]);

      const out: StockAIFundamentals = {};

      // Basic financials → metric block (all ratios as numbers)
      if (basicsRes.status === 'fulfilled') {
        const m = basicsRes.value?.metric ?? {};
        const num = (v: unknown): number | undefined =>
          typeof v === 'number' && Number.isFinite(v) ? v : undefined;

        out.peRatio          = num(m.peNormalizedAnnual ?? m.peTTM ?? m.peBasicExclExtraTTM);
        out.pegRatio         = num(m.pegRatioTTM);
        out.psRatio          = num(m.psTTM);
        out.epsTTM           = num(m.epsNormalizedAnnual ?? m.epsTTM);
        out.revenueGrowthYoy = num(m.revenueGrowthTTMYoy ?? m.revenueGrowthQuarterlyYoy);
        out.epsGrowthYoy     = num(m.epsGrowthTTMYoy ?? m.epsGrowthQuarterlyYoy);
        out.grossMargin      = num(m.grossMarginTTM);
        out.operatingMargin  = num(m.operatingMarginTTM);
        out.netMargin         = num(m.netProfitMarginTTM);
        out.roe              = num(m.roeTTM ?? m.roeRfy);
        out.weeks52high      = num(m['52WeekHigh']);
        out.weeks52low       = num(m['52WeekLow']);
      }

      // Analyst recommendations — most recent monthly snapshot
      if (recRes.status === 'fulfilled' && Array.isArray(recRes.value) && recRes.value.length) {
        const latest = recRes.value[0];
        out.analystRec = {
          strongBuy:  latest.strongBuy  ?? 0,
          buy:        latest.buy        ?? 0,
          hold:       latest.hold       ?? 0,
          sell:       latest.sell       ?? 0,
          strongSell: latest.strongSell ?? 0,
        };
      }

      // Price target
      if (ptRes.status === 'fulfilled' && ptRes.value) {
        const pt = ptRes.value;
        out.priceTargetMean = typeof pt.targetMean === 'number' ? pt.targetMean : undefined;
        out.priceTargetHigh = typeof pt.targetHigh === 'number' ? pt.targetHigh : undefined;
        out.priceTargetLow  = typeof pt.targetLow  === 'number' ? pt.targetLow  : undefined;
      }

      // Upcoming earnings — first future date
      if (earningsRes.status === 'fulfilled') {
        const cal = earningsRes.value?.earningsCalendar ?? [];
        const todayStr = today.toISOString().slice(0, 10);
        const upcoming = cal
          .filter((e) => e.date >= todayStr)
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (upcoming) out.upcomingEarningsDate = upcoming.date;
      }

      // Return null if we got literally nothing
      const hasAny = Object.values(out).some((v) => v !== undefined);
      return hasAny ? out : null;
    },
  });
}
