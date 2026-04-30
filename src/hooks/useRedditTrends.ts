import { useQuery } from '@tanstack/react-query';
import { fetchRedditTrends, type RedditTrendFilter, type RedditTrendsResponse } from '../api/reddit';

export interface UseRedditTrendsParams {
  filter?: RedditTrendFilter;
  page?: number;
  limit?: number;
}

export function useRedditTrends(params: UseRedditTrendsParams = {}) {
  const {
    filter = 'all-stocks',
    page = 1,
    limit = 50,
  } = params;

  return useQuery<RedditTrendsResponse>({
    queryKey: ['reddit-trends', { filter, page, limit }],
    queryFn: () => fetchRedditTrends({ filter, page, limit }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
