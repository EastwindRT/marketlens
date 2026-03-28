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
