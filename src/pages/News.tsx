import { lazy, Suspense, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ExternalLink, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import type { CongressTrade } from '../api/congress';
import type { InsiderTransaction } from '../api/types';

const FilingSheet = lazy(() =>
  import('../components/ui/FilingSheet').then((m) => ({ default: m.FilingSheet }))
);
import { useWatchlistStore } from '../store/watchlistStore';
import { fetchInsiderData, getInsiderType } from '../hooks/useInsiderData';
import { useCongressTradesForWatchlist } from '../hooks/useCongressTrades';

interface CorrelatedSignal {
  ticker: string;
  month: string;
  direction: 'buy' | 'sell';
  congressTrades: CongressTrade[];
  insiderTrades: FlatTrade[];
}

interface FlatTrade extends InsiderTransaction {
  symbol: string;
  tradeType: 'BUY' | 'SELL' | 'GRANT' | 'TAX_SELL';
}

type CachedFilingsPayload = {
  filings: MarketFiling[];
  fetchedAt: number;
};

const marketFilingsCacheKey = (days: number) => `tars:market-filings:${days}`;

function readCachedFilings(days: number): CachedFilingsPayload | null {
  try {
    const raw = sessionStorage.getItem(marketFilingsCacheKey(days));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.filings)) return null;
    return {
      filings: parsed.filings,
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeCachedFilings(days: number, filings: MarketFiling[]) {
  try {
    sessionStorage.setItem(
      marketFilingsCacheKey(days),
      JSON.stringify({ filings, fetchedAt: Date.now() })
    );
  } catch {
    // Ignore cache write failures and rely on the live query.
  }
}

function formStyle(formType: string): { bg: string; color: string; border: string } {
  if (formType === '13D') return { bg: 'rgba(247,147,26,0.15)', color: '#F7931A', border: 'rgba(247,147,26,0.5)' };
  if (formType === '13D/A') return { bg: 'rgba(247,147,26,0.08)', color: '#F7931A', border: 'rgba(247,147,26,0.3)' };
  if (formType === '13G') return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.4)' };
  if (formType === '13G/A') return { bg: 'rgba(45,107,255,0.07)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.25)' };
  if (formType.startsWith('13D') || formType.startsWith('SCHEDULE 13D')) {
    return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.3)' };
  }
  return { bg: 'var(--bg-hover)', color: 'var(--text-secondary)', border: 'var(--border-subtle)' };
}

function formTypeLabel(formType: string): { intent: string; amended: boolean } {
  const amended = formType.endsWith('/A');
  const base = amended ? formType.slice(0, -2) : formType;
  return {
    intent: base === '13D' || base === 'SCHEDULE 13D' ? 'Activist' : 'Passive',
    amended,
  };
}

function findCorrelations(insiderTrades: FlatTrade[], congressTrades: CongressTrade[]): CorrelatedSignal[] {
  const insiderMap = new Map<string, FlatTrade[]>();
  for (const trade of insiderTrades) {
    if (trade.tradeType !== 'BUY' && trade.tradeType !== 'SELL') continue;
    const ym = trade.transactionDate.slice(0, 7);
    const dir = trade.tradeType === 'BUY' ? 'buy' : 'sell';
    const key = `${trade.symbol.replace(/\.TO$/i, '').toUpperCase()}_${ym}_${dir}`;
    const bucket = insiderMap.get(key) ?? [];
    bucket.push(trade);
    insiderMap.set(key, bucket);
  }

  const congressMap = new Map<string, CongressTrade[]>();
  for (const trade of congressTrades) {
    if (trade.type !== 'purchase' && trade.type !== 'sale') continue;
    const ym = trade.transactionDate.slice(0, 7);
    const dir = trade.type === 'purchase' ? 'buy' : 'sell';
    const key = `${trade.ticker.toUpperCase()}_${ym}_${dir}`;
    const bucket = congressMap.get(key) ?? [];
    bucket.push(trade);
    congressMap.set(key, bucket);
  }

  const signals: CorrelatedSignal[] = [];
  for (const [key, congressional] of congressMap) {
    const insiders = insiderMap.get(key);
    if (!insiders?.length) continue;
    const [ticker, month, direction] = key.split('_');
    signals.push({
      ticker,
      month,
      direction: direction as 'buy' | 'sell',
      congressTrades: congressional,
      insiderTrades: insiders,
    });
  }

  return signals.sort((a, b) => b.month.localeCompare(a.month));
}

function FilingsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse"
          style={{
            padding: 14,
            borderRadius: 12,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div style={{ width: 56, height: 22, borderRadius: 6, background: 'var(--bg-hover)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '55%', height: 13, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 6 }} />
            <div style={{ width: '35%', height: 10, borderRadius: 4, background: 'var(--bg-hover)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NewsPage() {
  const [days, setDays] = useState(14);
  const [selectedFiling, setSelectedFiling] = useState<MarketFiling | null>(null);
  const [filingsSort, setFilingsSort] = useState<'date' | 'filer' | 'subject'>('date');
  const [formFilter, setFormFilter] = useState<'all' | '13D' | '13D/A' | '13G' | '13G/A'>('all');
  const [sectorFilter, setSectorFilter] = useState('All sectors');
  const [confSort, setConfSort] = useState<'date' | 'trades'>('date');
  const navigate = useNavigate();
  const { items: watchlist } = useWatchlistStore();
  const signalSymbols = useMemo(
    () => [...new Set(watchlist.map((item) => item.symbol))],
    [watchlist]
  );
  const cachedFilings = useMemo(() => readCachedFilings(days), [days]);

  const { data: filings, isLoading: filingsLoading, error: filingsError } = useQuery({
    queryKey: ['market-filings', days],
    queryFn: async () => {
      const next = await edgar.getRecentFilings(days);
      writeCachedFilings(days, next);
      return next;
    },
    initialData: cachedFilings?.filings,
    initialDataUpdatedAt: cachedFilings?.fetchedAt,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const {
    data: watchlistCongressTrades,
    isLoading: congressLoading,
    error: congressError,
  } = useCongressTradesForWatchlist(
    signalSymbols.map((symbol) => symbol.replace(/\.TO$/i, '')),
    Math.max(days, 90)
  );

  const insiderQueries = useQueries({
    queries: signalSymbols.map((symbol) => ({
      queryKey: ['insiders', symbol],
      queryFn: () => fetchInsiderData(symbol),
      staleTime: 5 * 60 * 1000,
      enabled: signalSymbols.length > 0,
    })),
  });

  const watchlistInsiderTrades = useMemo(() => {
    const cutoff = subDays(new Date(), 90);
    return signalSymbols.flatMap((symbol, index) => {
      const query = insiderQueries[index];
      if (!query?.data) return [];
      return query.data
        .filter((trade) =>
          trade.transactionDate &&
          trade.transactionPrice &&
          new Date(trade.transactionDate) >= cutoff &&
          getInsiderType(trade.transactionCode, trade.change) !== 'GRANT'
        )
        .map((trade) => ({
          ...trade,
          symbol,
          tradeType: getInsiderType(trade.transactionCode, trade.change),
        }));
    });
  }, [insiderQueries, signalSymbols]);

  const correlations = useMemo(() => {
    if (!watchlistCongressTrades?.length || watchlistInsiderTrades.length === 0) return [];
    return findCorrelations(watchlistInsiderTrades, watchlistCongressTrades);
  }, [watchlistCongressTrades, watchlistInsiderTrades]);

  const sortedCorrelations = useMemo(() => {
    if (confSort === 'trades') {
      return [...correlations].sort(
        (a, b) => (b.congressTrades.length + b.insiderTrades.length) - (a.congressTrades.length + a.insiderTrades.length)
      );
    }
    return correlations;
  }, [confSort, correlations]);

  const subjectCompanies = useMemo(
    () => [...new Set((filings ?? []).map((filing) => filing.subjectCompany).filter(Boolean))] as string[],
    [filings]
  );

  const { data: filingMetadata } = useQuery({
    queryKey: ['filing-company-metadata', subjectCompanies.join('||')],
    queryFn: async (): Promise<{ items: Array<{ subjectCompany: string; symbol: string | null; sector: string | null; industry: string | null }> }> => {
      const response = await fetch(`/api/company-metadata?subjects=${encodeURIComponent(subjectCompanies.join('||'))}`);
      if (!response.ok) throw new Error(`Company metadata ${response.status}`);
      return response.json();
    },
    enabled: subjectCompanies.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const filingMetadataMap = useMemo(() => {
    return new Map((filingMetadata?.items ?? []).map((item) => [item.subjectCompany, item]));
  }, [filingMetadata]);

  const enrichedFilings = useMemo(() => {
    return (filings ?? []).map((filing) => ({
      ...filing,
      symbol: filingMetadataMap.get(filing.subjectCompany || '')?.symbol ?? filing.symbol ?? null,
      sector: filingMetadataMap.get(filing.subjectCompany || '')?.sector ?? filing.sector ?? null,
      industry: filingMetadataMap.get(filing.subjectCompany || '')?.industry ?? filing.industry ?? null,
    }));
  }, [filings, filingMetadataMap]);

  const filingSectors = useMemo(() => {
    const values = new Set<string>();
    for (const filing of enrichedFilings) {
      if (filing.sector) values.add(filing.sector);
    }
    return ['All sectors', ...[...values].sort((a, b) => a.localeCompare(b))];
  }, [enrichedFilings]);

  const sortedFilings = useMemo(() => {
    let list = enrichedFilings;
    if (formFilter !== 'all') list = list.filter((filing) => filing.formType === formFilter);
    if (sectorFilter !== 'All sectors') list = list.filter((filing) => (filing.sector || 'Unknown') === sectorFilter);
    return [...list].sort((a, b) => {
      if (filingsSort === 'filer') return (a.filerName ?? '').localeCompare(b.filerName ?? '');
      if (filingsSort === 'subject') return (a.subjectCompany ?? 'ZZZ').localeCompare(b.subjectCompany ?? 'ZZZ');
      return b.filedDate.localeCompare(a.filedDate);
    });
  }, [enrichedFilings, filingsSort, formFilter, sectorFilter]);

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate = format(new Date(), 'MMM d');
  const signalsLoading = signalSymbols.length > 0 && (congressLoading || insiderQueries.some((query) => query.isLoading));
  const signalsError = Boolean(congressError) || insiderQueries.some((query) => query.isError);

  return (
    <>
      <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ margin: '0 0 3px', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em' }}>
                Market Signals
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                Insider trades · 13D/13G filings · {fromDate} - {toDate}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {[7, 14, 30].map((value) => (
                <button
                  key={value}
                  onClick={() => setDays(value)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 16,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    background: days === value ? 'var(--bg-elevated)' : 'transparent',
                    color: days === value ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: `1px solid ${days === value ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                    transition: 'all 120ms',
                  }}
                >
                  {value}d
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
            <SectionHeader
              noMargin
              title="Confluence Signals"
              subtitle="Congress members and company insiders trading the same watchlist stock in the same month"
            />
            {sortedCorrelations.length > 0 && (
              <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 2, border: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                {(['date', 'trades'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setConfSort(option)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: 'none',
                      background: confSort === option ? 'var(--bg-hover)' : 'transparent',
                      color: confSort === option ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    {option === 'date' ? 'Date' : 'Activity'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {signalSymbols.length === 0 && (
            <EmptyState message="Add stocks to your watchlist to unlock crossovers between insider trades and congressional activity." />
          )}

          {signalSymbols.length > 0 && signalsLoading && <FilingsSkeleton />}

          {signalSymbols.length > 0 && signalsError && (
            <p style={{ color: 'var(--color-down)', fontSize: 13, padding: '0 0 20px' }}>
              Could not load confluence signals right now.
            </p>
          )}

          {signalSymbols.length > 0 && !signalsLoading && !signalsError && sortedCorrelations.length === 0 && (
            <EmptyState message="No insider and congress overlap matched your watchlist in the current window." />
          )}

          {signalSymbols.length > 0 && !signalsLoading && !signalsError && sortedCorrelations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
              {sortedCorrelations.slice(0, 10).map((signal, index) => {
                const isBuy = signal.direction === 'buy';
                const accentColor = isBuy ? '#05B169' : '#F6465D';
                const accentBg = isBuy ? 'rgba(5,177,105,0.08)' : 'rgba(246,70,93,0.08)';
                const accentBorder = isBuy ? 'rgba(5,177,105,0.3)' : 'rgba(246,70,93,0.3)';
                const label = isBuy ? 'BULLISH CONFLUENCE' : 'BEARISH CONFLUENCE';
                const congressMembers = [...new Set(signal.congressTrades.map((trade) => trade.member))];
                const insiderNames = [...new Set(signal.insiderTrades.map((trade) => trade.name))];

                return (
                  <button
                    key={`${signal.ticker}_${signal.month}_${signal.direction}_${index}`}
                    onClick={() => navigate(`/stock/${signal.ticker}`)}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      textAlign: 'left',
                      width: '100%',
                      cursor: 'pointer',
                      background: accentBg,
                      border: `1px solid ${accentBorder}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2, flexShrink: 0 }}>
                      <Zap size={15} color={accentColor} fill={accentColor} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {signal.ticker}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: accentColor, color: '#fff' }}>
                          {label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {signal.month}
                        </span>
                      </div>

                      <div style={{ marginBottom: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
                        Congress: {congressMembers.slice(0, 3).join(', ')}
                        {congressMembers.length > 3 ? ` +${congressMembers.length - 3} more` : ''}
                        <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                          ({signal.congressTrades.length} trade{signal.congressTrades.length !== 1 ? 's' : ''})
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Insiders: {insiderNames.slice(0, 2).join(', ')}
                        {insiderNames.length > 2 ? ` +${insiderNames.length - 2} more` : ''}
                        <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                          ({signal.insiderTrades.length} trade{signal.insiderTrades.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
            <SectionHeader
              noMargin
              title="Major Ownership Filings"
              subtitle={`${sortedFilings.length} filings · 13D activist · 13G passive · 5%+ stake disclosures`}
            />
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 2, border: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              {(['date', 'filer', 'subject'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setFilingsSort(option)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    background: filingsSort === option ? 'var(--bg-hover)' : 'transparent',
                    color: filingsSort === option ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  }}
                >
                  {option === 'date' ? 'Date' : option === 'filer' ? 'Filer' : 'Subject'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {(['all', '13D', '13D/A', '13G', '13G/A'] as const).map((filter) => {
              const isActive = formFilter === filter;
              let activeColor = 'var(--accent-blue-light)';
              let activeBg = 'rgba(45,107,255,0.12)';
              let activeBorder = 'rgba(45,107,255,0.4)';
              if (filter === '13D') {
                activeColor = '#F7931A';
                activeBg = 'rgba(247,147,26,0.15)';
                activeBorder = 'rgba(247,147,26,0.5)';
              }
              if (filter === '13D/A') {
                activeColor = '#F7931A';
                activeBg = 'rgba(247,147,26,0.10)';
                activeBorder = 'rgba(247,147,26,0.35)';
              }
              if (filter === '13G/A') {
                activeBg = 'rgba(45,107,255,0.08)';
                activeBorder = 'rgba(45,107,255,0.25)';
              }
              return (
                <button
                  key={filter}
                  onClick={() => setFormFilter(filter)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 14,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: isActive ? activeBg : 'var(--bg-elevated)',
                    color: isActive ? (filter === 'all' ? 'var(--text-primary)' : activeColor) : 'var(--text-tertiary)',
                    border: `1px solid ${isActive ? activeBorder : 'var(--border-subtle)'}`,
                  }}
                >
                  {filter === 'all' ? 'All' : filter}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <select
              value={sectorFilter}
              onChange={(event) => setSectorFilter(event.target.value)}
              style={{
                minWidth: 180,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 12,
              }}
            >
              {filingSectors.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
          </div>

          {filingsLoading && <FilingsSkeleton />}

          {filingsError && (
            <p style={{ color: 'var(--color-down)', fontSize: 13, padding: '12px 0' }}>
              Could not load filings. EDGAR may be temporarily unavailable.
            </p>
          )}

          {!filingsLoading && !filingsError && sortedFilings.length === 0 && (
            <EmptyState message={`No 13D/13G filings in the last ${days} days.`}>
              <a
                href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SCHEDULE+13D&dateb=&owner=include&count=40&output=atom"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8 }}
              >
                Browse on EDGAR <ExternalLink size={12} />
              </a>
            </EmptyState>
          )}

          {!filingsLoading && !filingsError && sortedFilings.length > 0 && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedFilings.map((filing, index) => {
                  const fc = formStyle(filing.formType);
                  const { intent, amended } = formTypeLabel(filing.formType);
                  return (
                    <button
                      key={filing.accessionNo || index}
                      onClick={() => setSelectedFiling(filing)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 14,
                        borderRadius: 12,
                        textAlign: 'left',
                        width: '100%',
                        cursor: 'pointer',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, flexShrink: 0 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 7px',
                            borderRadius: 6,
                            whiteSpace: 'nowrap',
                            background: fc.bg,
                            color: fc.color,
                            border: `1px solid ${fc.border}`,
                            fontFamily: "'Roboto Mono', monospace",
                          }}
                        >
                          {filing.formType}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {intent}{amended ? ' · Amended' : ''}
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {filing.subjectCompany && (
                          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {filing.subjectCompany}
                          </p>
                        )}
                        <p style={{ margin: 0, fontSize: 12, color: filing.subjectCompany ? 'var(--text-secondary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filing.subjectCompany ? `Filed by ${filing.filerName}` : filing.filerName}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {filing.filedDate}
                          {filing.symbol ? ` · ${filing.symbol}` : ''}
                          {filing.sector ? ` · ${filing.sector}` : ''}
                          {filing.periodOfReport && filing.periodOfReport !== filing.filedDate ? ` · Period: ${filing.periodOfReport}` : ''}
                        </p>
                      </div>

                      <ExternalLink size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                    </button>
                  );
                })}
              </div>

              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14 }}>
                <span style={{ color: '#F7931A', fontWeight: 600 }}>13D</span> = 5%+ stake, activist intent ·{' '}
                <span style={{ color: 'var(--accent-blue-light)', fontWeight: 600 }}>13G</span> = 5%+ stake, passive · Source: SEC EDGAR
              </p>
            </>
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        {selectedFiling && (
          <FilingSheet filing={selectedFiling} onClose={() => setSelectedFiling(null)} />
        )}
      </Suspense>
    </>
  );
}

function SectionHeader({ title, subtitle, noMargin }: { title: string; subtitle: string; noMargin?: boolean }) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 12 }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>{subtitle}</p>
    </div>
  );
}

function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: '20px 0 32px', textAlign: 'center' }}>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0 }}>{message}</p>
      {children}
    </div>
  );
}
