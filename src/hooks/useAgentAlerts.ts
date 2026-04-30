import { useQuery } from '@tanstack/react-query';
import { fetchAlertsLatest, fetchConvergenceSignals, fetchInsiderFilings, fetchMacroCalendar, type AlertsLatestResponse, type ConvergenceResponse, type InsiderFilingsResponse, type MacroCalendarResponse } from '../api/news';

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

export function useConvergenceSignals(playerId?: string | null, days = 14) {
  return useQuery<ConvergenceResponse>({
    queryKey: ['agent-alerts', 'convergence', playerId ?? 'none', days],
    queryFn: () => fetchConvergenceSignals(playerId ?? undefined, days),
    enabled: Boolean(playerId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
