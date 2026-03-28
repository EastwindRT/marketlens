import type { OHLCVBar } from '../api/types';

/**
 * Find the candle closest to (but not after) a given ISO date string.
 */
function findCandle(candles: OHLCVBar[], isoDate: string): OHLCVBar | null {
  if (!candles.length) return null;
  const target = isoDate.slice(0, 10);
  // Find exact match first
  const exact = candles.find(c => (c.time as string).slice(0, 10) === target);
  if (exact) return exact;
  // Otherwise find nearest candle on or before that date
  const before = candles.filter(c => (c.time as string).slice(0, 10) <= target);
  return before.length ? before[before.length - 1] : null;
}

/**
 * Add N calendar days to an ISO date string.
 */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PostTradePerformance {
  pct30d: number | null;   // % change 30 days after transaction
  pct90d: number | null;   // % change 90 days after transaction
}

/**
 * Calculate price performance after an insider trade.
 * Returns null when candle data doesn't cover the required period.
 */
export function calcPostTradePerf(
  transactionDate: string,
  candles: OHLCVBar[]
): PostTradePerformance {
  const base = findCandle(candles, transactionDate);
  if (!base || base.close === 0) return { pct30d: null, pct90d: null };

  const after30 = findCandle(candles, addDays(transactionDate, 30));
  const after90 = findCandle(candles, addDays(transactionDate, 90));

  // Don't report if the "after" candle is the same as the base (not enough data)
  const pct30d = after30 && after30.time !== base.time
    ? ((after30.close - base.close) / base.close) * 100
    : null;
  const pct90d = after90 && after90.time !== base.time
    ? ((after90.close - base.close) / base.close) * 100
    : null;

  return { pct30d, pct90d };
}

/**
 * Format a performance percentage for display.
 * e.g. 8.3 → "+8.3%", -4.1 → "-4.1%"
 */
export function fmtPerf(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Return the semantic colour for a performance value given the trade type.
 * A buy that goes up = good (green), a sell that goes up = bad (red), etc.
 */
export function perfColor(pct: number | null, tradeType: 'BUY' | 'SELL'): string {
  if (pct === null) return 'var(--text-tertiary)';
  const positive = pct >= 0;
  // For a BUY: price up = green (thesis confirmed), price down = red (underwater)
  // For a SELL: price up = red (sold too early), price down = green (sold at peak)
  const good = tradeType === 'BUY' ? positive : !positive;
  return good ? 'var(--color-up)' : 'var(--color-down)';
}
