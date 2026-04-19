import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { isTSXTicker } from '../utils/marketHours';

export interface PeerQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  peRatio?: number;
  marketCap?: number;
}

/**
 * Fetches peer symbols from Finnhub, then parallel-fetches quotes + basic metrics.
 * US only — Finnhub peer data is not reliable for TSX.
 */
export function usePeerComparison(symbol: string, enabled = true) {
  return useQuery<PeerQuote[]>({
    queryKey: ['peer-comparison', symbol],
    enabled: enabled && !!symbol && !isTSXTicker(symbol),
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      // Peers list (includes the symbol itself first — skip it)
      const peers = await finnhub.getPeers(symbol);
      if (!Array.isArray(peers) || peers.length === 0) return [];

      // Take up to 5 peers (exclude self, prefer same exchange stocks)
      const targets = peers
        .filter(p => p !== symbol && !isTSXTicker(p))
        .slice(0, 5);

      if (targets.length === 0) return [];

      const results = await Promise.allSettled(
        targets.map(async (sym): Promise<PeerQuote> => {
          const [quote, basics] = await Promise.allSettled([
            finnhub.getQuote(sym),
            finnhub.getBasicFinancials(sym),
          ]);
          const q = quote.status === 'fulfilled' ? quote.value : null;
          const m = basics.status === 'fulfilled' ? (basics.value?.metric ?? {}) : {};

          return {
            symbol: sym,
            price: q?.c ?? 0,
            change: q?.d ?? 0,
            changePct: q?.dp ?? 0,
            peRatio: typeof m.peTTM === 'number' && isFinite(m.peTTM) ? m.peTTM : undefined,
            marketCap: typeof m.marketCapitalization === 'number' ? m.marketCapitalization : undefined,
          };
        })
      );

      return results
        .filter(r => r.status === 'fulfilled' && r.value.price > 0)
        .map(r => (r as PromiseFulfilledResult<PeerQuote>).value);
    },
  });
}
