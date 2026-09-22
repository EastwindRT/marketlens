import { useQuery } from '@tanstack/react-query';
import {
  fetchOwnershipFilingsTriage,
  type InvestorType,
  type OwnershipFilingsTriageResponse,
} from '../api/ownershipFilings';

export interface UseOwnershipFilingsParams {
  minMateriality?: number;
  investorType?: InvestorType;
  days?: number;
  escalatedOnly?: boolean;
  limit?: number;
}

export function useOwnershipFilings(params: UseOwnershipFilingsParams = {}) {
  const {
    minMateriality = 0,
    investorType,
    days = 14,
    escalatedOnly = false,
    limit = 100,
  } = params;

  return useQuery<OwnershipFilingsTriageResponse>({
    queryKey: ['ownership-filings-triage', { minMateriality, investorType, days, escalatedOnly, limit }],
    queryFn: () => fetchOwnershipFilingsTriage({ minMateriality, investorType, days, escalatedOnly, limit }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}
