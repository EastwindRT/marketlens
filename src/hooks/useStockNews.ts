import { useQuery } from '@tanstack/react-query';
import { finnhub } from '../api/finnhub';
import { format, subDays } from 'date-fns';

export function useStockNews(symbol: string) {
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['news', symbol, from],
    queryFn: () => finnhub.getCompanyNews(symbol, from, to),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: !!symbol && !symbol.endsWith('.TO'),
  });
}
