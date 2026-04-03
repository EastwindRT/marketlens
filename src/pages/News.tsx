import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import { format, subDays } from 'date-fns';
import { useWatchlistStore } from '../store/watchlistStore';
import { useInsiderData, getInsiderType } from '../hooks/useInsiderData';
import type { InsiderTransaction } from '../api/types';
import { formatPrice, formatLargeNumber } from '../utils/formatters';
import { isTSXTicker } from '../utils/marketHours';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formStyle(formType: string): { bg: string; color: string; border: string } {
  if (formType.startsWith('13D') || formType.startsWith('SCHEDULE 13D'))
    return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.3)' };
  return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.3)' };
}

function typeStyle(type: 'BUY' | 'SELL' | 'GRANT' | 'TAX_SELL') {
  if (type === 'BUY')      return { bg: 'rgba(5,177,105,0.12)',   color: '#05B169', border: 'rgba(5,177,105,0.25)' };
  if (type === 'TAX_SELL') return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.25)' };
  if (type === 'GRANT')    return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.25)' };
  return                          { bg: 'rgba(246,70,93,0.12)',  color: '#F6465D', border: 'rgba(246,70,93,0.25)' };
}

function FilingsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse" style={{
          padding: 14, borderRadius: 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
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

// ── Watchlist Insider Feed ─────────────────────────────────────────────────────
// One component per ticker so we can use hooks legally

interface FlatTrade extends InsiderTransaction {
  symbol: string;
  tradeType: 'BUY' | 'SELL' | 'GRANT' | 'TAX_SELL';
}

function useWatchlistInsiders(symbols: string[], days: number): {
  trades: FlatTrade[];
  loading: boolean;
} {
  // Fetch each ticker — React Query dedupes & caches
  const results = symbols.map(sym => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return { symbol: sym, q: useInsiderData(sym) };
  });

  const loading = results.some(r => r.q.isLoading);
  const cutoff  = subDays(new Date(), days);

  const trades: FlatTrade[] = results.flatMap(({ symbol, q }) => {
    if (!q.data) return [];
    return q.data
      .filter(t => {
        if (!t.transactionDate || !t.transactionPrice) return false;
        const type = getInsiderType(t.transactionCode, t.change);
        if (type === 'GRANT') return false; // skip grants in the feed
        return new Date(t.transactionDate) >= cutoff;
      })
      .map(t => ({
        ...t,
        symbol,
        tradeType: getInsiderType(t.transactionCode, t.change),
      }));
  });

  // Sort by date desc
  trades.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  return { trades, loading };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [days, setDays] = useState(14);
  const navigate = useNavigate();
  const { items: watchlist } = useWatchlistStore();
  const symbols = watchlist.map(w => w.symbol);

  const { data: filings, isLoading: filingsLoading, error: filingsError } = useQuery({
    queryKey: ['market-filings', days],
    queryFn:  () => edgar.getRecentFilings(days),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const { trades: insiderTrades, loading: insidersLoading } = useWatchlistInsiders(symbols, days);

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate   = format(new Date(), 'MMM d');

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{
              margin: '0 0 3px', fontSize: 20, fontWeight: 700,
              color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em',
            }}>
              Market Signals
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
              Insider trades · 13D/13G filings · {fromDate} – {toDate}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                  fontSize: 12, fontWeight: 500, fontFamily: "'Inter', sans-serif",
                  background: days === d ? 'var(--bg-elevated)' : 'transparent',
                  color: days === d ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  border: `1px solid ${days === d ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                  transition: 'all 120ms',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* ── SECTION 1: Watchlist Insider Trades ── */}
        <SectionHeader title="Watchlist Insider Activity" subtitle="Form 4 / SEDI trades for your watched stocks" />

        {insidersLoading && <FilingsSkeleton />}

        {!insidersLoading && insiderTrades.length === 0 && (
          <EmptyState message={`No insider trades in the last ${days} days for your watchlist.`} />
        )}

        {!insidersLoading && insiderTrades.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 32 }}>
            {insiderTrades.map((t, i) => {
              const ts = typeStyle(t.tradeType);
              const isCA = isTSXTicker(t.symbol);
              const currency = isCA ? 'CAD' : 'USD';
              const value = t.transactionPrice * Math.abs(t.change);
              const baseTicker = t.symbol.replace(/\.TO$/i, '');
              return (
                <button
                  key={`${t.symbol}-${t.transactionDate}-${t.name}-${i}`}
                  onClick={() => navigate(`/stock/${t.symbol}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    borderRadius: 12, textDecoration: 'none', textAlign: 'left', width: '100%',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    transition: 'border-color 150ms', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  {/* Ticker */}
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                    flexShrink: 0, background: 'var(--bg-hover)',
                    color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace",
                    minWidth: 52, textAlign: 'center',
                  }}>
                    {baseTicker}
                  </span>

                  {/* Type badge */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6, flexShrink: 0,
                    background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`,
                    fontFamily: "'Roboto Mono', monospace",
                  }}>
                    {t.tradeType === 'TAX_SELL' ? 'F-SELL' : t.tradeType}
                  </span>

                  {/* Name + details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: '0 0 1px', fontSize: 13, fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                      {Math.abs(t.change).toLocaleString()} shares · {formatPrice(t.transactionPrice, currency as any)} · {formatLargeNumber(value)} · {t.transactionDate.slice(0, 10)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── SECTION 2: 13D / 13G Major Filings ── */}
        <SectionHeader title="Major Ownership Filings" subtitle="13D activist · 13G passive — 5%+ stake disclosures via SEC EDGAR" />

        {filingsLoading && <FilingsSkeleton />}

        {filingsError && (
          <p style={{ color: 'var(--color-down)', fontSize: 13, padding: '12px 0' }}>
            Could not load filings — EDGAR may be temporarily unavailable.
          </p>
        )}

        {!filingsLoading && !filingsError && filings?.length === 0 && (
          <EmptyState message={`No 13D/13G filings in the last ${days} days.`}>
            <a
              href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SCHEDULE+13D&dateb=&owner=include&count=40&output=atom"
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8 }}
            >
              Browse on EDGAR <ExternalLink size={12} />
            </a>
          </EmptyState>
        )}

        {!filingsLoading && !filingsError && filings && filings.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filings.map((f: MarketFiling, i: number) => {
                const fc = formStyle(f.formType);
                return (
                  <a
                    key={f.accessionNo || i}
                    href={f.edgarUrl}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                      borderRadius: 12, textDecoration: 'none',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                      flexShrink: 0, whiteSpace: 'nowrap',
                      background: fc.bg, color: fc.color, border: `1px solid ${fc.border}`,
                      fontFamily: "'Roboto Mono', monospace",
                    }}>
                      {f.formType}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {f.subjectCompany && (
                        <p style={{
                          margin: '0 0 2px', fontSize: 13, fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {f.subjectCompany}
                        </p>
                      )}
                      <p style={{
                        margin: 0, fontSize: 12,
                        color: f.subjectCompany ? 'var(--text-secondary)' : 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {f.subjectCompany ? `Filed by ${f.filerName}` : f.filerName}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                        {f.filedDate}
                        {f.periodOfReport && f.periodOfReport !== f.filedDate ? ` · Period: ${f.periodOfReport}` : ''}
                      </p>
                    </div>

                    <ExternalLink size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                  </a>
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
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{
        margin: '0 0 2px', fontSize: 15, fontWeight: 700,
        color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em',
      }}>
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
