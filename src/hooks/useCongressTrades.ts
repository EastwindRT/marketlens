import { useQuery } from '@tanstack/react-query';
import { congress } from '../api/congress';

/** Trades for a single stock (StockDetail page) */
export function useCongressTrades(ticker: string) {
  return useQuery({
    queryKey: ['congress-trades', ticker],
    queryFn:  () => congress.getTradesForTicker(ticker),
    staleTime: 6 * 60 * 60 * 1000,  // 6h — data updates once a day at most
    retry: 1,
    enabled: !!ticker,
  });
}

/** Recent trades across a list of tickers (Market Signals page) */
export function useCongressTradesForWatchlist(tickers: string[], days = 90) {
  return useQuery({
    queryKey: ['congress-watchlist', tickers.slice().sort().join(','), days],
    queryFn:  () => congress.getTradesForTickers(tickers, days),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    enabled: tickers.length > 0,
  });
}

/**
 * Latest N trades across all house members — not filtered by ticker.
 * Backed by House Stock Watcher (has 2024-2025 data).
 */
export function useLatestCongressTrades(limit = 50) {
  return useQuery({
    queryKey: ['congress-latest', limit],
    queryFn:  () => congress.getLatestTrades(limit),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}
