import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';

export function useAnalystData(symbol: string) {
  const recs = useQuery({
    queryKey: ['analyst-recs', symbol],
    queryFn: () => finnhub.getRecommendations(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !symbol.endsWith('.TO'),
  });

  const target = useQuery({
    queryKey: ['price-target', symbol],
    queryFn: () => finnhub.getPriceTarget(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !symbol.endsWith('.TO'),
  });

  const earnings = useQuery({
    queryKey: ['earnings', symbol],
    queryFn: () => finnhub.getEarnings(symbol),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !symbol.endsWith('.TO'),
  });

  return { recs, target, earnings };
}
