import { useQuery } from '@tanstack/react-query';
import { fetchRedditTrends, type RedditTrendFilter, type RedditTrendsResponse } from '../api/reddit';

export interface UseRedditTrendsParams {
  filter?: RedditTrendFilter;
  page?: number;
  limit?: number;
  playerId?: string;
}

export function useRedditTrends(params: UseRedditTrendsParams = {}) {
  const {
    filter = 'all-stocks',
    page = 1,
    limit = 50,
    playerId,
  } = params;

  return useQuery<RedditTrendsResponse>({
    queryKey: ['reddit-trends', { filter, page, limit, playerId }],
    queryFn: () => fetchRedditTrends({ filter, page, limit, playerId }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
