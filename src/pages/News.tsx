import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Zap, Sparkles, TrendingUp, TrendingDown, Minus, RotateCcw, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import { FilingSheet } from '../components/ui/FilingSheet';
import { format, subDays } from 'date-fns';
import { useWatchlistStore } from '../store/watchlistStore';
import { useInsiderData, getInsiderType } from '../hooks/useInsiderData';
import { useCongressTradesForWatchlist, useLatestCongressTrades } from '../hooks/useCongressTrades';
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

// Popular tickers for the insider feed — kept small to avoid Finnhub rate limits
const POPULAR_TICKERS = [
  'AAPL', 'NVDA', 'META', 'GOOGL', 'AMZN',
  'JPM', 'UNH', 'LLY',
  'SHOP.TO', 'TD.TO',
];

function useWatchlistInsiders(symbols: string[], _days: number): {
  trades: FlatTrade[];
  loading: boolean;
} {
  // Merge watchlist with popular tickers, dedupe
  const allSymbols = [...new Set([...symbols, ...POPULAR_TICKERS])];

  // Always use 90-day lookback for insiders — trades are infrequent
  const INSIDER_LOOKBACK_DAYS = 90;

  // Fetch each ticker — React Query dedupes & caches
  const results = allSymbols.map(sym => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return { symbol: sym, q: useInsiderData(sym) };
  });

  const loading = results.some(r => r.q.isLoading);
  const cutoff  = subDays(new Date(), INSIDER_LOOKBACK_DAYS);

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

  // Sort by date desc, cap at 100 rows
  trades.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  return { trades: trades.slice(0, 100), loading };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [days, setDays] = useState(14);
  const [selectedFiling, setSelectedFiling] = useState<MarketFiling | null>(null);
  const [showInsiderAI, setShowInsiderAI]   = useState(false);
  const [showCongressAI, setShowCongressAI] = useState(false);
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

  // Latest house trades (2024-2025 data) — not filtered by watchlist
  const { data: congressTrades, isLoading: congressLoading } = useLatestCongressTrades(60);
  // Keep watchlist congress for confluence signal detection
  const { data: watchlistCongressTrades } = useCongressTradesForWatchlist(
    symbols.map(s => s.replace(/\.TO$/i, '')),
    Math.max(days, 90)
  );

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate   = format(new Date(), 'MMM d');

  const correlations = useMemo(() => {
    if (!watchlistCongressTrades || insiderTrades.length === 0) return [];
    return findCorrelations(insiderTrades, watchlistCongressTrades);
  }, [insiderTrades, watchlistCongressTrades]);

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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionHeader title="Insider Activity" subtitle="Form 4 / SEDI trades — watchlist + popular stocks · last 90 days" noMargin />
          {!insidersLoading && insiderTrades.length > 0 && (
            <button
              onClick={() => setShowInsiderAI(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                background: showInsiderAI ? 'rgba(22,82,240,0.15)' : 'var(--bg-elevated)',
                border: showInsiderAI ? '1px solid rgba(45,107,255,0.4)' : '1px solid var(--border-default)',
                color: showInsiderAI ? 'var(--accent-blue-light)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, transition: 'all 150ms',
              }}
            >
              <Sparkles size={12} /> Ask AI
            </button>
          )}
        </div>

        {insidersLoading && <FilingsSkeleton />}

        {showInsiderAI && !insidersLoading && insiderTrades.length > 0 && (
          <FeedAICard
            key="insider-ai"
            endpoint="/api/analyze-insiders"
            payload={{ symbol: 'MARKET', trades: insiderTrades }}
            label="Quant Insider Analysis"
            onClose={() => setShowInsiderAI(false)}
          />
        )}

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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionHeader
            title="🏛 Congress Trades"
            subtitle="Latest House member disclosures — updated continuously"
            noMargin
          />
          {!congressLoading && congressTrades && congressTrades.length > 0 && (
            <button
              onClick={() => setShowCongressAI(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                background: showCongressAI ? 'rgba(22,82,240,0.15)' : 'var(--bg-elevated)',
                border: showCongressAI ? '1px solid rgba(45,107,255,0.4)' : '1px solid var(--border-default)',
                color: showCongressAI ? 'var(--accent-blue-light)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, transition: 'all 150ms',
              }}
            >
              <Sparkles size={12} /> Ask AI
            </button>
          )}
        </div>

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

        {showCongressAI && !congressLoading && congressTrades && congressTrades.length > 0 && (
          <FeedAICard
            key="congress-ai"
            endpoint="/api/analyze-congress"
            payload={{ trades: congressTrades }}
            label="Political Risk Desk Analysis"
            onClose={() => setShowCongressAI(false)}
          />
        )}

        {!congressLoading && (!congressTrades || congressTrades.length === 0) && (
          <EmptyState message="No recent House trades found — data may still be loading." />
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
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>House</span>
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

// ── Feed AI Card ──────────────────────────────────────────────────────────────

interface FeedAnalysis {
  hypothesis: string;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  sentimentSummary: string;
  pattern: string;
  topInsiders?: string[];
  topMembers?: string[];
  netBuyValue?: string;
  buyCount: number;
  sellCount: number;
  thesis: string;
  catalysts: string[];
  risks: string[];
  keyTrade: string;
}

function FeedAICard({
  endpoint,
  payload,
  label,
  onClose,
}: {
  endpoint: string;
  payload: object;
  label: string;
  onClose: () => void;
}) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FeedAnalysis | null>(null);
  const ran = useRef(false);

  async function run() {
    setError(null); setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
      setAnalysis(json.analysis as FeedAnalysis);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally { setLoading(false); }
  }

  useEffect(() => { if (!ran.current) { ran.current = true; run(); } }, []);

  const sigColor = (s?: string) =>
    s === 'BULLISH' ? '#05B169' : s === 'BEARISH' ? '#F6465D' : s === 'MIXED' ? '#F7931A' : '#8A8F98';
  const sigBg = (s?: string) =>
    s === 'BULLISH' ? 'rgba(5,177,105,0.1)' : s === 'BEARISH' ? 'rgba(246,70,93,0.1)' : s === 'MIXED' ? 'rgba(247,147,26,0.1)' : 'rgba(138,143,152,0.1)';
  const convColor = (c?: string) =>
    c === 'HIGH' ? '#05B169' : c === 'MEDIUM' ? '#F7931A' : '#8A8F98';

  return (
    <div style={{
      marginBottom: 20, borderRadius: 14,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={13} color="var(--accent-blue-light)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>· Llama 3.3 70B</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
      </div>

      <div style={{ padding: '16px 18px' }}>
        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[88, 65, 78, 50].map((w, i) => (
              <div key={i} className="animate-pulse" style={{ height: 12, borderRadius: 6, background: 'var(--bg-hover)', width: `${w}%` }} />
            ))}
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Analysing data…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={14} color="#F6465D" />
            <span style={{ fontSize: 13, color: '#F6465D', flex: 1 }}>{error}</span>
            <button onClick={run} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', background: 'var(--bg-hover)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
              <RotateCcw size={11} /> Retry
            </button>
          </div>
        )}

        {/* Result */}
        {!loading && !error && analysis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Hypothesis hero */}
            {analysis.hypothesis && (
              <div style={{
                padding: '13px 15px', borderRadius: 11,
                background: `linear-gradient(135deg, ${sigBg(analysis.signal)}, rgba(22,82,240,0.05))`,
                border: `1px solid ${sigColor(analysis.signal)}44`,
              }}>
                <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Why They're {analysis.signal === 'BEARISH' ? 'Selling' : 'Buying'}
                </p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5, letterSpacing: '-0.01em' }}>
                  "{analysis.hypothesis}"
                </p>
              </div>
            )}

            {/* Signal row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 9, background: sigBg(analysis.signal), border: `1px solid ${sigColor(analysis.signal)}33` }}>
                {analysis.signal === 'BULLISH' ? <TrendingUp size={13} color={sigColor(analysis.signal)} /> : analysis.signal === 'BEARISH' ? <TrendingDown size={13} color={sigColor(analysis.signal)} /> : <Minus size={13} color={sigColor(analysis.signal)} />}
                <span style={{ fontSize: 14, fontWeight: 800, color: sigColor(analysis.signal) }}>{analysis.signal}</span>
              </div>
              <div style={{ padding: '6px 11px', borderRadius: 8, background: 'var(--bg-hover)', border: '1px solid var(--border-default)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 5 }}>Conviction</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: convColor(analysis.conviction) }}>{analysis.conviction}</span>
              </div>
              <div style={{ padding: '6px 11px', borderRadius: 8, background: 'var(--bg-hover)', border: '1px solid var(--border-default)' }}>
                <span style={{ fontSize: 11, color: '#05B169', marginRight: 4 }}>▲ {analysis.buyCount ?? 0}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '0 3px' }}>·</span>
                <span style={{ fontSize: 11, color: '#F6465D', marginLeft: 4 }}>▼ {analysis.sellCount ?? 0}</span>
              </div>
            </div>

            {/* Pattern */}
            {analysis.pattern && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: 3, flexShrink: 0 }}>Pattern</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 10px', borderRadius: 6, background: 'rgba(45,107,255,0.08)', border: '1px solid rgba(45,107,255,0.2)' }}>{analysis.pattern}</span>
              </div>
            )}

            {/* Key actors */}
            {((analysis.topInsiders && analysis.topInsiders.length > 0) || (analysis.topMembers && analysis.topMembers.length > 0)) && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Key Players</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(analysis.topInsiders || analysis.topMembers || []).slice(0, 4).map((x, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 8, borderLeft: '2px solid var(--border-default)' }}>{x}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Thesis */}
            {analysis.thesis && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px' }}>Thesis</p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{analysis.thesis}</p>
              </div>
            )}

            {/* Key Trade */}
            {analysis.keyTrade && (
              <div style={{ padding: '10px 13px', borderRadius: 9, background: 'rgba(45,107,255,0.06)', border: '1px solid rgba(45,107,255,0.15)' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }}>Key Trade</span>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{analysis.keyTrade}</p>
              </div>
            )}

            {/* Catalysts + Risks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {analysis.catalysts?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#05B169', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px' }}>Catalysts</p>
                  <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {analysis.catalysts.map((c, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c}</li>)}
                  </ul>
                </div>
              )}
              {analysis.risks?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#F6465D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px' }}>Risks</p>
                  <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {analysis.risks.map((r, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, noMargin }: { title: string; subtitle: string; noMargin?: boolean }) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 12 }}>
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
