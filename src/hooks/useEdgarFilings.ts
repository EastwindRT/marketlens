import { useQuery } from '@tanstack/react-query';
import { edgar } from '../api/edgar';

export function useEdgarFilings(symbol: string, isCanadian: boolean) {
  return useQuery({
    queryKey: ['edgar-13d', symbol],
    queryFn: () => edgar.get13DFilings(symbol),
    staleTime: 4 * 60 * 60 * 1000, // 4h
    retry: 1,
    enabled: !!symbol && !isCanadian,
  });
}
