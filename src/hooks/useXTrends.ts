import { useQuery } from '@tanstack/react-query';
import { fetchXTrends, type XTrendsResponse } from '../api/xSocial';

export interface UseXTrendsParams {
  hours?: number;
  limit?: number;
}

export function useXTrends(params: UseXTrendsParams = {}) {
  const { hours = 72, limit = 100 } = params;

  return useQuery<XTrendsResponse>({
    queryKey: ['x-trends', { hours, limit }],
    queryFn: () => fetchXTrends({ hours, limit }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
