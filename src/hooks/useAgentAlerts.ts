import { useQuery } from '@tanstack/react-query';
import { fetchAlertsLatest, fetchInsiderFilings, fetchMacroCalendar, type AlertsLatestResponse, type InsiderFilingsResponse, type MacroCalendarResponse } from '../api/news';

export function useAgentLatestAlert(playerId?: string | null) {
  return useQuery<AlertsLatestResponse>({
    queryKey: ['agent-alerts', 'latest', playerId ?? 'global'],
    queryFn: () => fetchAlertsLatest(playerId ?? undefined),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

export function useAgentInsiderFilings(days = 7) {
  return useQuery<InsiderFilingsResponse>({
    queryKey: ['agent-alerts', 'insider-filings', days],
    queryFn: () => fetchInsiderFilings(days),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

export function useMacroCalendar(limit = 8) {
  return useQuery<MacroCalendarResponse>({
    queryKey: ['agent-alerts', 'macro-calendar', limit],
    queryFn: () => fetchMacroCalendar(limit),
    staleTime: 30 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
