import type { OHLCVBar } from '../api/types';

export function calculateSMA(data: OHLCVBar[], period: number): { time: number | string; value: number }[] {
  const result: { time: number | string; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, bar) => acc + bar.close, 0);
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

export function calculateEMA(data: OHLCVBar[], period: number): { time: number | string; value: number }[] {
  const result: { time: number | string; value: number }[] = [];
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((acc, bar) => acc + bar.close, 0) / period;

  result.push({ time: data[period - 1].time, value: ema });

  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

export function calculateAverageVolume(data: OHLCVBar[], period: number): number | null {
  if (data.length < period) return null;
  const sample = data.slice(-period);
  const total = sample.reduce((sum, bar) => sum + (bar.volume || 0), 0);
  return total / period;
}

export function calculateRelativeVolume(data: OHLCVBar[], period = 20): {
  latestVolume: number | null;
  averageVolume: number | null;
  rvol: number | null;
} {
  if (data.length === 0) {
    return { latestVolume: null, averageVolume: null, rvol: null };
  }

  const latestVolume = data[data.length - 1]?.volume ?? null;
  if (latestVolume == null || latestVolume <= 0 || data.length <= 1) {
    return { latestVolume, averageVolume: null, rvol: null };
  }

  const comparisonWindow = data.slice(0, -1);
  if (comparisonWindow.length < period) {
    return { latestVolume, averageVolume: null, rvol: null };
  }

  const sample = comparisonWindow.slice(-period);
  const averageVolume = sample.reduce((sum, bar) => sum + (bar.volume || 0), 0) / sample.length;
  return {
    latestVolume,
    averageVolume,
    rvol: averageVolume > 0 ? latestVolume / averageVolume : null,
  };
}
