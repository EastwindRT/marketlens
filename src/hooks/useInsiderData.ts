import { useQuery } from '@tanstack/react-query';
import { format, subYears } from 'date-fns';
import { finnhub } from '../api/finnhub';
import { tmx, type TMXInsiderTransaction } from '../api/tmx';
import type { InsiderTransaction } from '../api/types';
import { generateMockInsiders } from '../utils/mockData';
import { isTSXTicker } from '../utils/marketHours';

const FROM_DATE = format(subYears(new Date(), 2), 'yyyy-MM-dd');
const TO_DATE = format(new Date(), 'yyyy-MM-dd');

const hasApiKey = () => !!import.meta.env.VITE_FINNHUB_API_KEY;
const SEC_RELEVANT = ['P', 'S', 'S-'];

export const SEC_CODE_LABELS: Record<string, string> = {
  P: 'Open Market Purchase',
  S: 'Open Market Sale',
  'S-': 'Sale under 10b5-1 Plan',
  A: 'Grant / Award (no payment)',
  M: 'Exercise of Derivative',
  F: 'Tax Withholding (auto-sell)',
  G: 'Gift',
  D: 'Returned to Issuer',
  I: 'Discretionary Transaction',
  J: 'Other Transaction',
  C: 'Conversion of Derivative',
  W: 'Acquired by Inheritance',
  X: 'Exercise of In-the-Money Option',
  O: 'Exercise of Out-of-the-Money Option',
};

export const SEDI_CODE_LABELS: Record<string, string> = {
  '1': 'Public Market Acquisition / Disposition',
  '2': 'Conversion / Exercise',
  '3': 'Deemed Acquisition',
  '4': 'Deemed Disposition',
  '10': 'Normal Course Issuer Bid',
  '24': 'Grant of Warrants',
  '25': 'Grant of Options',
  '26': 'Grant of Rights (DSU / RSU / PSU)',
  '27': 'Opening Balance - Initial Filing',
  '28': 'Employee Stock Purchase Plan',
  '30': 'Gift of Securities',
  '32': 'Stock Dividend',
  '38': 'Deemed Beneficial Ownership',
};

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

function formatFilerName(filer: string): string {
  if (!filer) return '';
  const parts = filer.split(',').map((part) => part.trim());
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return filer;
}

function formatRelationship(rel: string): string {
  if (!rel) return '';
  return rel
    .replace(/\s+of\s+Issuer$/i, '')
    .replace(/\s+of\s+the\s+Issuer$/i, '')
    .trim();
}

export async function fetchInsiderData(symbol: string): Promise<InsiderTransaction[]> {
  if (!hasApiKey()) return generateMockInsiders(symbol);

  if (isTSXTicker(symbol)) {
    try {
      const raw = await tmx.getInsiderTransactions(symbol);
      return raw
        .filter((txn) =>
          (txn.transactionTypeCode === 1 || txn.transactionTypeCode === 2) &&
          txn.pricefrom > 0 &&
          txn.amount > 0 &&
          txn.securitydesignation?.toLowerCase().includes('common')
        )
        .map(mapTMXTransaction);
    } catch {
      return [];
    }
  }

  try {
    const response = await finnhub.getInsiderTransactions(symbol, FROM_DATE, TO_DATE);
    const allData: any[] = response.data || [];
    return allData
      .filter((txn) => SEC_RELEVANT.includes(txn.transactionCode) && txn.transactionPrice > 0 && Math.abs(txn.change ?? txn.share ?? 0) > 0)
      .map((txn) => ({
        ...txn,
        rawCode: txn.transactionCode,
        rawReason: SEC_CODE_LABELS[txn.transactionCode as keyof typeof SEC_CODE_LABELS] || txn.transactionCode,
        isDerivative: txn.isDerivative ?? false,
      }));
  } catch {
    return [];
  }
}

export function useInsiderData(symbol: string) {
  return useQuery({
    queryKey: ['insiders', symbol],
    queryFn: () => fetchInsiderData(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

export function getInsiderType(code: string, change?: number): 'BUY' | 'SELL' | 'GRANT' | 'TAX_SELL' {
  if (code === 'P') return 'BUY';
  if (code === 'S' || code === 'S-') return 'SELL';
  if (code === 'F') return 'TAX_SELL';
  if (code === 'A') return 'GRANT';
  return (change ?? 0) >= 0 ? 'BUY' : 'SELL';
}
