import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { InsiderFeedItem } from '../api/types';
import { useWatchlistStore } from '../store/watchlistStore';
import { formatLargeNumber, formatPrice } from '../utils/formatters';

type SortMode = 'value' | 'date';
type FilterMode = 'all' | 'buy' | 'sell';

export default function InsiderActivityPage() {
  const navigate = useNavigate();
  const [sortMode, setSortMode] = useState<SortMode>('value');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const watchlistSymbols = useWatchlistStore((state) => state.items.map((item) => item.symbol));

  const { data, isLoading, error } = useQuery({
    queryKey: ['insider-activity-feed'],
    queryFn: async (): Promise<{ trades: InsiderFeedItem[] }> => {
      const res = await fetch('/api/insider-activity');
      if (!res.ok) throw new Error(`Feed error ${res.status}`);
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const trades = useMemo(() => {
    const base = (data?.trades ?? []).filter((trade) => {
      if (filterMode === 'buy') return trade.type === 'BUY';
      if (filterMode === 'sell') return trade.type === 'SELL';
      return true;
    });

    return [...base].sort((a, b) => {
      if (sortMode === 'date') return b.transactionDate.localeCompare(a.transactionDate);
      return b.totalValue - a.totalValue;
    });
  }, [data?.trades, filterMode, sortMode]);

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
              Insider $
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
              Market-wide insider buys and sells, ranked by dollar activity or freshness.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <SegmentedControl<SortMode>
              value={sortMode}
              onChange={setSortMode}
              options={[
                { id: 'value', label: 'Largest $' },
                { id: 'date', label: 'Newest' },
              ]}
            />
            <SegmentedControl<FilterMode>
              value={filterMode}
              onChange={setFilterMode}
              options={[
                { id: 'all', label: 'All' },
                { id: 'buy', label: 'Buys' },
                { id: 'sell', label: 'Sells' },
              ]}
            />
          </div>
        </div>

        {isLoading && <FeedSkeleton />}

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
                const inWatchlist = watchlistSymbols.includes(trade.symbol);
                const accentColor = isBuy ? 'var(--color-up)' : 'var(--color-down)';
                const accentBg = isBuy ? 'rgba(5,177,105,0.1)' : 'rgba(246,70,93,0.1)';

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
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: accentBg,
                            color: accentColor,
                            border: `1px solid ${accentColor}`,
                            fontFamily: "'Roboto Mono', monospace",
                          }}
                        >
                          {trade.type}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'var(--bg-hover)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-default)',
                            fontFamily: "'Roboto Mono', monospace",
                          }}
                        >
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
                        <a
                          href={trade.filingUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          style={{ color: 'var(--text-tertiary)', flexShrink: 0, alignSelf: 'center' }}
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-tertiary)' }}>
              Current feed uses the SEC Form 4 current filings stream and normalizes open-market insider activity into a sortable tape.
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
