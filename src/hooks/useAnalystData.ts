import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { isTSXTicker } from '../utils/marketHours';

export function useAnalystData(symbol: string) {
  const recs = useQuery({
    queryKey: ['analyst-recs', symbol],
    queryFn: () => finnhub.getRecommendations(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !isTSXTicker(symbol),
  });

  const target = useQuery({
    queryKey: ['price-target', symbol],
    queryFn: () => finnhub.getPriceTarget(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !isTSXTicker(symbol),
  });

  const earnings = useQuery({
    queryKey: ['earnings', symbol],
    queryFn: () => finnhub.getEarnings(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !isTSXTicker(symbol),
  });

  return { recs, target, earnings };
}
