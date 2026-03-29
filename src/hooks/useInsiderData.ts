import { useQuery } from '@tanstack/react-query';
import { format, subYears } from 'date-fns';
import { finnhub } from '../api/finnhub';
import { tmx, type TMXInsiderTransaction } from '../api/tmx';
import type { InsiderTransaction } from '../api/types';
import { generateMockInsiders } from '../utils/mockData';
import { isTSXTicker } from '../utils/marketHours';

// Fetch 2 years of insider history
const FROM_DATE = format(subYears(new Date(), 2), 'yyyy-MM-dd');
const TO_DATE   = format(new Date(), 'yyyy-MM-dd');

const hasApiKey = () => !!import.meta.env.VITE_FINNHUB_API_KEY;

// SEC Form 4 codes — purchases, sales, grants, and tax-withholding sells
const SEC_RELEVANT = ['P', 'S', 'S-', 'A', 'F'];

/** Full label for each SEC Form 4 transaction code */
export const SEC_CODE_LABELS: Record<string, string> = {
  P:  'Open Market Purchase',
  S:  'Open Market Sale',
  'S-': 'Sale under 10b5-1 Plan',
  A:  'Grant / Award (no payment)',
  M:  'Exercise of Derivative',
  F:  'Tax Withholding (auto-sell)',
  G:  'Gift',
  D:  'Returned to Issuer',
  I:  'Discretionary Transaction',
  J:  'Other Transaction',
  C:  'Conversion of Derivative',
  W:  'Acquired by Inheritance',
  X:  'Exercise of In-the-Money Option',
  O:  'Exercise of Out-of-the-Money Option',
};

/** Full label for each SEDI transaction type code */
export const SEDI_CODE_LABELS: Record<string, string> = {
  '1':  'Public Market Acquisition / Disposition',
  '2':  'Conversion / Exercise',
  '3':  'Deemed Acquisition',
  '4':  'Deemed Disposition',
  '10': 'Normal Course Issuer Bid',
  '24': 'Grant of Warrants',
  '25': 'Grant of Options',
  '26': 'Grant of Rights (DSU / RSU / PSU)',
  '27': 'Opening Balance — Initial Filing',
  '28': 'Employee Stock Purchase Plan',
  '30': 'Gift of Securities',
  '32': 'Stock Dividend',
  '38': 'Deemed Beneficial Ownership',
};

/**
 * Map a TMX SEDI transaction to the app's InsiderTransaction shape.
 * transactionTypeCode: 1 = Acquisition (BUY), 2 = Disposition (SELL)
 */
function mapTMXTransaction(t: TMXInsiderTransaction): InsiderTransaction {
  const isBuy = t.transactionTypeCode === 1;
  return {
    name: formatFilerName(t.filer),
    title: formatRelationship(t.relationship),
    share: Math.abs(t.amount),
    change: isBuy ? Math.abs(t.amount) : -Math.abs(t.amount),
    filingDate: t.filingdate,
    transactionDate: t.datefrom || t.date,
    transactionCode: isBuy ? 'P' : 'S',
    transactionPrice: t.pricefrom,
    rawCode: String(t.transactionTypeCode),
    rawReason: t.type || '',
    isDerivative: false,
  };
}

/**
 * Convert "McKibbon, Terrance Lloyd" → "Terrance Lloyd McKibbon"
 */
function formatFilerName(filer: string): string {
  if (!filer) return '';
  const parts = filer.split(',').map(s => s.trim());
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return filer;
}

/**
 * Clean up TMX relationship strings.
 * "Director of Issuer" → "Director"
 * "Senior Officer of Issuer" → "Senior Officer"
 */
function formatRelationship(rel: string): string {
  if (!rel) return '';
  return rel
    .replace(/\s+of\s+Issuer$/i, '')
    .replace(/\s+of\s+the\s+Issuer$/i, '')
    .trim();
}

export function useInsiderData(symbol: string) {
  return useQuery({
    queryKey: ['insiders', symbol],
    queryFn: async (): Promise<InsiderTransaction[]> => {
      if (!hasApiKey()) return generateMockInsiders(symbol);

      const isCA = isTSXTicker(symbol);

      // ── Canadian stocks: use TMX / SEDI data ──────────────────────────────
      if (isCA) {
        try {
          const raw = await tmx.getInsiderTransactions(symbol);

          return raw
            .filter(t =>
              // Only market transactions (code 1 = buy, 2 = sell)
              (t.transactionTypeCode === 1 || t.transactionTypeCode === 2) &&
              t.pricefrom > 0 &&
              t.amount > 0 &&
              t.securitydesignation?.toLowerCase().includes('common') // Common shares only
            )
            .map(mapTMXTransaction);
        } catch {
          return [];
        }
      }

      // ── US stocks: use Finnhub SEC Form 4 data ────────────────────────────
      try {
        const response = await finnhub.getInsiderTransactions(symbol, FROM_DATE, TO_DATE);
        const allData: any[] = response.data || [];
        return allData
          .filter(t => SEC_RELEVANT.includes(t.transactionCode))
          .map(t => ({
            ...t,
            rawCode:    t.transactionCode,
            rawReason:  SEC_CODE_LABELS[t.transactionCode as keyof typeof SEC_CODE_LABELS] || t.transactionCode,
            isDerivative: t.isDerivative ?? false,
          }));
      } catch {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Determine BUY, SELL, or GRANT from transaction code.
 * Works for both Finnhub SEC codes and mapped TMX codes.
 */
export function getInsiderType(code: string, change?: number): 'BUY' | 'SELL' | 'GRANT' {
  if (code === 'P') return 'BUY';
  if (code === 'S' || code === 'S-' || code === 'F') return 'SELL';
  if (code === 'A') return 'GRANT';
  // Fallback: use change direction
  return (change ?? 0) >= 0 ? 'BUY' : 'SELL';
}
