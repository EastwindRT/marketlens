import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { InsiderFeedItem } from '../api/types';
import { useWatchlistStore } from '../store/watchlistStore';
import { formatLargeNumber, formatPrice } from '../utils/formatters';

type SortMode = 'value' | 'date';
type FilterMode = 'all' | 'buy' | 'sell';
type PeriodMode = '7d' | '14d' | '30d';
type MarketTab = 'us' | 'ca-insiders' | 'ca-filings';

export default function InsiderActivityPage() {
  const navigate = useNavigate();
  const [marketTab, setMarketTab] = useState<MarketTab>('us');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('7d');
  const watchlistSymbols = useWatchlistStore((state) => state.items.map((item) => item.symbol));

  const days = periodMode === '7d' ? 7 : periodMode === '14d' ? 14 : 30;
  const caMode = marketTab === 'ca-filings' ? 'filings' : 'insiders';

  // US feed — EDGAR Form 4
  const { data: usData, isLoading: usLoading, error: usError } = useQuery({
    queryKey: ['insider-activity-feed', days],
    queryFn: async (): Promise<{ trades: InsiderFeedItem[] }> => {
      const res = await fetch(`/api/insider-activity?days=${days}`);
      if (!res.ok) throw new Error(`Feed error ${res.status}`);
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
    enabled: marketTab === 'us',
  });

  // CA feed — TMX / SEDI
  const { data: caData, isLoading: caLoading, error: caError } = useQuery({
    queryKey: ['ca-insider-activity', days, caMode],
    queryFn: async (): Promise<{ trades: InsiderFeedItem[] }> => {
      const res = await fetch(`/api/ca-insider-activity?days=${days}&mode=${caMode}`);
      if (!res.ok) throw new Error(`CA feed error ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
    enabled: marketTab !== 'us',
  });

  const rawTrades = marketTab === 'us' ? (usData?.trades ?? []) : (caData?.trades ?? []);
  const isLoading = marketTab === 'us' ? usLoading : caLoading;
  const error = marketTab === 'us' ? usError : caError;

  const trades = useMemo(() => {
    const base = rawTrades.filter((trade) => {
      if (filterMode === 'buy') return trade.type === 'BUY';
      if (filterMode === 'sell') return trade.type === 'SELL';
      return true;
    });
    return [...base].sort((a, b) => {
      if (sortMode === 'date') return (b.transactionDate || '').localeCompare(a.transactionDate || '');
      return (b.totalValue ?? 0) - (a.totalValue ?? 0);
    });
  }, [rawTrades, filterMode, sortMode]);

  const tabLabel = {
    'us': 'US · SEC Form 4',
    'ca-insiders': 'CA · SEDI open-market',
    'ca-filings': 'CA · all SEDI filings',
  }[marketTab];

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            Insider $
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Market-wide insider activity ranked by dollar value or freshness.
          </p>
        </div>

        {/* Market tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {([
            { id: 'us',         label: '🇺🇸 US Insiders' },
            { id: 'ca-insiders', label: '🇨🇦 CA Insiders' },
            { id: 'ca-filings', label: '🇨🇦 CA Filings' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setMarketTab(t.id)}
              style={{
                padding: '7px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: marketTab === t.id ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: marketTab === t.id ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${marketTab === t.id ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                transition: 'all 120ms',
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Controls — shared across all tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          <SegmentedControl<PeriodMode>
            value={periodMode}
            onChange={setPeriodMode}
            options={[
              { id: '7d', label: '7D' },
              { id: '14d', label: '14D' },
              { id: '30d', label: '30D' },
            ]}
          />
          <SegmentedControl<SortMode>
            value={sortMode}
            onChange={setSortMode}
            options={[
              { id: 'value', label: 'Largest $' },
              { id: 'date', label: 'Newest' },
            ]}
          />
          {/* Buy/Sell filter — only meaningful for insiders tabs (not all-filings) */}
          {marketTab !== 'ca-filings' && (
            <SegmentedControl<FilterMode>
              value={filterMode}
              onChange={setFilterMode}
              options={[
                { id: 'all', label: 'All' },
                { id: 'buy', label: 'Buys' },
                { id: 'sell', label: 'Sells' },
              ]}
            />
          )}
        </div>

        {isLoading && <FeedSkeleton />}

        {/* CA tabs loading note */}
        {marketTab !== 'us' && isLoading && (
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: -12, marginBottom: 16 }}>
            Querying ~110 TSX stocks via SEDI — may take 20–40s on first load…
          </p>
        )}

        {error && (
          <div style={{ padding: 16, borderRadius: 12, background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)' }}>
            <p style={{ margin: 0, color: 'var(--color-down)', fontSize: 13 }}>
              Could not load insider activity right now.
            </p>
          </div>
        )}

        {!isLoading && !error && trades.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 13 }}>
              No insider activity matched the current filter.
            </p>
          </div>
        )}

        {!isLoading && !error && trades.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {trades.map((trade) => {
                const isBuy = trade.type === 'BUY';
                const isOther = trade.type === 'OTHER';
                const inWatchlist = watchlistSymbols.includes(trade.symbol);
                const accentColor = isBuy ? 'var(--color-up)' : isOther ? 'var(--text-tertiary)' : 'var(--color-down)';
                const accentBg = isBuy ? 'rgba(5,177,105,0.1)' : isOther ? 'var(--bg-hover)' : 'rgba(246,70,93,0.1)';

                return (
                  <button
                    key={trade.id}
                    onClick={() => navigate(`/stock/${trade.symbol}`)}
                    style={{
                      width: '100%',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      borderRadius: 14,
                      padding: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'border-color 150ms',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', flexShrink: 0 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: accentBg, color: accentColor, border: `1px solid ${accentColor}`,
                          fontFamily: "'Roboto Mono', monospace",
                        }}>
                          {trade.type}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                          border: '1px solid var(--border-default)', fontFamily: "'Roboto Mono', monospace",
                        }}>
                          {trade.exchange}
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                            {trade.symbol}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{trade.companyName}</span>
                          {inWatchlist && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(22,82,240,0.12)', color: 'var(--accent-blue-light)' }}>
                              WATCHLIST
                            </span>
                          )}
                        </div>

                        <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-primary)' }}>
                          {trade.insiderName}
                          {trade.title ? <span style={{ color: 'var(--text-tertiary)' }}> · {trade.title}</span> : null}
                        </p>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, rowGap: 6 }}>
                          <DataPoint label="Date" value={trade.transactionDate} />
                          <DataPoint label="Shares" value={Math.abs(trade.shares).toLocaleString()} />
                          <DataPoint label="Price" value={formatPrice(trade.pricePerShare, trade.market === 'CA' ? 'CAD' : 'USD')} />
                          <DataPoint label="Value" value={formatLargeNumber(trade.totalValue)} strong color={accentColor} />
                        </div>
                      </div>

                      {trade.filingUrl ? (
                        <a href={trade.filingUrl} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'var(--text-tertiary)', flexShrink: 0, alignSelf: 'center' }}>
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-tertiary)' }}>
              {tabLabel} · {trades.length} transactions · {days}D window
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function DataPoint({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: color ?? 'var(--text-secondary)',
          fontWeight: strong ? 700 : 500,
          fontFamily: strong ? "'Roboto Mono', monospace" : "'Inter', sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 8, padding: 2, border: '1px solid var(--border-subtle)' }}>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: value === option.id ? 'var(--bg-hover)' : 'transparent',
            color: value === option.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} style={{ padding: 14, borderRadius: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ width: 68, height: 22, borderRadius: 6, background: 'var(--bg-hover)', marginBottom: 10 }} className="animate-pulse" />
          <div style={{ width: '40%', height: 14, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 8 }} className="animate-pulse" />
          <div style={{ width: '75%', height: 12, borderRadius: 4, background: 'var(--bg-hover)' }} className="animate-pulse" />
        </div>
      ))}
    </div>
  );
}
