import { useQuery } from '@tanstack/react-query';
import { fetchFilingsFeed, type FilingsFeedParams, type FilingsFeedResponse } from '../api/filings';

export function useFilingsFeed(params: FilingsFeedParams = {}) {
  return useQuery<FilingsFeedResponse>({
    queryKey: ['filings-feed', params],
    queryFn: () => fetchFilingsFeed(params),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
