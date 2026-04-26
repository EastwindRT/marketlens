import { useQuery } from '@tanstack/react-query';
import { fetchNewsImpact, type NewsCategory, type NewsImpactResponse } from '../api/news';

export interface UseNewsImpactParams {
  minScore?: number;
  category?: NewsCategory | 'all';
  days?: number;
  all?: boolean;
}

export function useNewsImpact(params: UseNewsImpactParams = {}) {
  const {
    minScore = 7,
    category = 'all',
    days = 1,
    all = false,
  } = params;

  return useQuery<NewsImpactResponse>({
    queryKey: ['news-impact', { minScore, category, days, all }],
    queryFn: () => fetchNewsImpact({ minScore, category, days, all }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
