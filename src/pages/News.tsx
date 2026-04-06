import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import { FilingSheet } from '../components/ui/FilingSheet';
import { format, subDays } from 'date-fns';
import { useWatchlistStore } from '../store/watchlistStore';
import { useInsiderData, getInsiderType } from '../hooks/useInsiderData';
import { useCongressTradesForWatchlist } from '../hooks/useCongressTrades';
import type { InsiderTransaction } from '../api/types';
import type { CongressTrade } from '../api/congress';
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

// ── Correlation helpers ────────────────────────────────────────────────────────

interface CorrelatedSignal {
  ticker: string;
  month: string;           // "2024-01"
  direction: 'buy' | 'sell';
  congressTrades: CongressTrade[];
  insiderTrades: FlatTradeBase[];
}

interface FlatTradeBase {
  name: string;
  tradeType: 'BUY' | 'SELL' | 'GRANT' | 'TAX_SELL';
  transactionDate: string;
  transactionPrice: number;
  change: number;
  symbol: string;
}

function findCorrelations(
  insiderTrades: FlatTradeBase[],
  congressTrades: CongressTrade[]
): CorrelatedSignal[] {
  // Build insider map: "TICKER_YYYY-MM_buy" → trades
  const insiderMap = new Map<string, FlatTradeBase[]>();
  for (const t of insiderTrades) {
    if (t.tradeType !== 'BUY' && t.tradeType !== 'SELL') continue;
    const ym = t.transactionDate.slice(0, 7);
    const dir = t.tradeType === 'BUY' ? 'buy' : 'sell';
    const key = `${t.symbol.replace(/\.TO$/i, '').toUpperCase()}_${ym}_${dir}`;
    const arr = insiderMap.get(key) ?? [];
    arr.push(t);
    insiderMap.set(key, arr);
  }

  // Build congress map: same key format
  const congressMap = new Map<string, CongressTrade[]>();
  for (const t of congressTrades) {
    if (t.type !== 'purchase' && t.type !== 'sale') continue;
    const ym = t.transactionDate.slice(0, 7);
    const dir = t.type === 'purchase' ? 'buy' : 'sell';
    const key = `${t.ticker.toUpperCase()}_${ym}_${dir}`;
    const arr = congressMap.get(key) ?? [];
    arr.push(t);
    congressMap.set(key, arr);
  }

  const signals: CorrelatedSignal[] = [];
  for (const [key, congressional] of congressMap) {
    const insiders = insiderMap.get(key);
    if (!insiders || insiders.length === 0) continue;
    const parts = key.split('_');
    const ticker = parts[0];
    const month  = parts[1];
    const dir    = parts[2] as 'buy' | 'sell';
    signals.push({ ticker, month, direction: dir, congressTrades: congressional, insiderTrades: insiders });
  }

  return signals.sort((a, b) => b.month.localeCompare(a.month));
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
  const [selectedFiling, setSelectedFiling] = useState<MarketFiling | null>(null);
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

  const { data: congressTrades, isLoading: congressLoading } = useCongressTradesForWatchlist(
    symbols.map(s => s.replace(/\.TO$/i, '')),
    Math.max(days, 90)  // congress data is slower, always look back at least 90d
  );

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate   = format(new Date(), 'MMM d');

  const correlations = useMemo(() => {
    if (!congressTrades || insiderTrades.length === 0) return [];
    return findCorrelations(insiderTrades, congressTrades);
  }, [insiderTrades, congressTrades]);

  return (
    <>
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

        {/* ── SECTION 0: Confluence Signals ── */}
        {correlations.length > 0 && (
          <>
            <SectionHeader
              title="⚡ Confluence Signals"
              subtitle="Congress members + company insiders traded the same stock in the same month"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
              {correlations.slice(0, 10).map((sig, i) => {
                const isBuy = sig.direction === 'buy';
                const accentColor  = isBuy ? '#05B169' : '#F6465D';
                const accentBg     = isBuy ? 'rgba(5,177,105,0.08)' : 'rgba(246,70,93,0.08)';
                const accentBorder = isBuy ? 'rgba(5,177,105,0.3)'  : 'rgba(246,70,93,0.3)';
                const label = isBuy ? 'BULLISH CONFLUENCE' : 'BEARISH CONFLUENCE';
                const congressMembers = [...new Set(sig.congressTrades.map(t => t.member))];
                const insiderNames    = [...new Set(sig.insiderTrades.map(t => t.name))];

                return (
                  <button
                    key={`${sig.ticker}_${sig.month}_${sig.direction}_${i}`}
                    onClick={() => navigate(`/stock/${sig.ticker}`)}
                    style={{
                      display: 'flex', gap: 12, padding: '12px 14px',
                      borderRadius: 12, textAlign: 'left', width: '100%', cursor: 'pointer',
                      background: accentBg, border: `1px solid ${accentBorder}`,
                      transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = accentColor)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = accentBorder)}
                  >
                    {/* Zap icon */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2, flexShrink: 0 }}>
                      <Zap size={15} color={accentColor} fill={accentColor} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
                          fontFamily: "'Roboto Mono', monospace",
                        }}>
                          {sig.ticker}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: accentColor, color: '#fff',
                          fontFamily: "'Inter', sans-serif", letterSpacing: '0.04em',
                        }}>
                          {label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {sig.month}
                        </span>
                      </div>

                      {/* Congress */}
                      <div style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 6 }}>🏛</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {congressMembers.slice(0, 3).join(', ')}
                          {congressMembers.length > 3 ? ` +${congressMembers.length - 3} more` : ''}
                          <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                            ({sig.congressTrades.length} trade{sig.congressTrades.length !== 1 ? 's' : ''})
                          </span>
                        </span>
                      </div>

                      {/* Insiders */}
                      <div>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 6 }}>👔</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {insiderNames.slice(0, 2).join(', ')}
                          {insiderNames.length > 2 ? ` +${insiderNames.length - 2} more` : ''}
                          <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                            ({sig.insiderTrades.length} trade{sig.insiderTrades.length !== 1 ? 's' : ''})
                          </span>
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

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

        {/* ── SECTION 2: Congress Trades ── */}
        <SectionHeader
          title="🏛 Congress Trades"
          subtitle="STOCK Act disclosures — House + Senate members"
        />

        {/* Live data link — always visible */}
        <a
          href="https://www.capitoltrades.com/trades"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 10, marginBottom: 12,
            background: 'rgba(22,82,240,0.08)', border: '1px solid rgba(22,82,240,0.25)',
            textDecoration: 'none', transition: 'border-color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(22,82,240,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(22,82,240,0.25)')}
        >
          <div>
            <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--accent-blue-light)' }}>
              Live congressional trades → Capitol Trades
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
              Real-time STOCK Act disclosures · updated daily · 200+ politicians tracked
            </p>
          </div>
          <ExternalLink size={13} color="var(--accent-blue-light)" style={{ flexShrink: 0 }} />
        </a>

        {congressLoading && <FilingsSkeleton />}

        {!congressLoading && (!congressTrades || congressTrades.length === 0) && (
          <EmptyState message="No historical trades on record for your watchlist (pre-2021 data only)." />
        )}

        {!congressLoading && congressTrades && congressTrades.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 32 }}>
            {congressTrades.map((t: CongressTrade, i: number) => {
              const isBuy = t.type === 'purchase';
              const tradeColor = isBuy ? '#05B169' : t.type === 'sale' ? '#F6465D' : 'var(--text-secondary)';
              const tradeBg   = isBuy ? 'rgba(5,177,105,0.1)' : t.type === 'sale' ? 'rgba(246,70,93,0.1)' : 'var(--bg-hover)';
              const partyColor = t.party === 'D' ? '#3B82F6' : t.party === 'R' ? '#F6465D' : 'var(--text-tertiary)';
              const partyBg   = t.party === 'D' ? 'rgba(59,130,246,0.12)' : t.party === 'R' ? 'rgba(246,70,93,0.1)' : 'var(--bg-hover)';

              return (
                <button
                  key={`${t.member}-${t.transactionDate}-${t.ticker}-${i}`}
                  onClick={() => navigate(`/stock/${t.ticker}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    borderRadius: 12, textAlign: 'left', width: '100%',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    transition: 'border-color 150ms', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  {/* Ticker */}
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                    background: 'var(--bg-hover)', color: 'var(--text-primary)',
                    fontFamily: "'Roboto Mono', monospace", minWidth: 52, textAlign: 'center', flexShrink: 0,
                  }}>
                    {t.ticker}
                  </span>

                  {/* Party */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: partyBg, color: partyColor, fontFamily: "'Roboto Mono', monospace",
                    minWidth: 22, textAlign: 'center', flexShrink: 0,
                  }}>
                    {t.party || '?'}
                  </span>

                  {/* Member + details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 1px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.member}{t.state ? ` (${t.state})` : ''}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: tradeBg, color: tradeColor, textTransform: 'uppercase', fontFamily: "'Roboto Mono', monospace" }}>
                        {t.type}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>{t.amount}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t.transactionDate.slice(0,10)}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{t.chamber === 'house' ? 'House' : 'Senate'}</span>
                    </div>
                  </div>

                  {t.filingUrl && (
                    <a href={t.filingUrl} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      <ExternalLink size={13} />
                    </a>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── SECTION 3: 13D / 13G Major Filings ── */}
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
                  <button
                    key={f.accessionNo || i}
                    onClick={() => setSelectedFiling(f)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                      borderRadius: 12, textAlign: 'left', width: '100%', cursor: 'pointer',
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

    <FilingSheet filing={selectedFiling} onClose={() => setSelectedFiling(null)} />
    </>
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
