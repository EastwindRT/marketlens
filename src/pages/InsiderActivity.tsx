import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { InsiderFeedItem, InsiderOverview } from '../api/types';
import { useWatchlistStore } from '../store/watchlistStore';
import { formatLargeNumber, formatPrice } from '../utils/formatters';
import { DataStatus } from '../components/ui/DataStatus';

type SortMode = 'value' | 'date';
type FilterMode = 'all' | 'buy' | 'sell';
type PeriodMode = '7d' | '14d' | '30d';
type MarketTab = 'us' | 'ca-insiders' | 'ca-filings';
type SymbolMetadata = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  companyName: string;
};

type InsiderResponse = {
  trades: InsiderFeedItem[];
  overview?: InsiderOverview;
};

function formatSignalLabel(signal?: string | null): string {
  switch (signal) {
    case 'net_buy':
      return 'Net Buy';
    case 'buy_skew':
      return 'Buy Skew';
    case 'net_sell':
      return 'Net Sell';
    case 'sell_skew':
      return 'Sell Skew';
    case 'tax_heavy':
      return 'Tax Heavy';
    default:
      return 'Mixed';
  }
}

export default function InsiderActivityPage() {
  const navigate = useNavigate();
  const [marketTab, setMarketTab] = useState<MarketTab>('ca-filings');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('30d');
  const [sectorFilter, setSectorFilter] = useState('All sectors');
  const watchlistSymbols = useWatchlistStore((state) => state.items.map((item) => item.symbol));

  const days = periodMode === '7d' ? 7 : periodMode === '14d' ? 14 : 30;
  const caMode = marketTab === 'ca-filings' ? 'filings' : 'insiders';

  const {
    data: usData,
    isFetching: usFetching,
    isLoading: usLoading,
    dataUpdatedAt: usUpdatedAt,
    error: usError,
  } = useQuery({
    queryKey: ['insider-activity-feed', days],
    queryFn: async (): Promise<InsiderResponse> => {
      const response = await fetch(`/api/insider-activity?days=${days}&limit=250`);
      if (!response.ok) throw new Error(`Feed error ${response.status}`);
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
    enabled: marketTab === 'us',
    placeholderData: (previous) => previous,
  });

  const {
    data: caData,
    isFetching: caFetching,
    isLoading: caLoading,
    dataUpdatedAt: caUpdatedAt,
    error: caError,
  } = useQuery({
    queryKey: ['ca-insider-activity', days, caMode],
    queryFn: async (): Promise<InsiderResponse> => {
      const response = await fetch(`/api/ca-insider-activity?days=${days}&mode=${caMode}&limit=250`);
      if (!response.ok) throw new Error(`CA feed error ${response.status}`);
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
    enabled: marketTab !== 'us',
    placeholderData: (previous) => previous,
  });

  const rawTrades = marketTab === 'us' ? (usData?.trades ?? []) : (caData?.trades ?? []);
  const overview = marketTab === 'us' ? usData?.overview : caData?.overview;
  const isLoading = marketTab === 'us' ? usLoading : caLoading;
  const isFetching = marketTab === 'us' ? usFetching : caFetching;
  const updatedAt = marketTab === 'us' ? usUpdatedAt : caUpdatedAt;
  const error = marketTab === 'us' ? usError : caError;
  const tradeSymbols = useMemo(() => [...new Set(rawTrades.map((trade) => trade.symbol).filter(Boolean))], [rawTrades]);

  const { data: symbolMetadata } = useQuery({
    queryKey: ['symbol-metadata', tradeSymbols.join(',')],
    queryFn: async (): Promise<{ items: SymbolMetadata[] }> => {
      const response = await fetch(`/api/symbol-metadata?symbols=${encodeURIComponent(tradeSymbols.join(','))}`);
      if (!response.ok) throw new Error(`Metadata error ${response.status}`);
      return response.json();
    },
    enabled: tradeSymbols.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const metadataMap = useMemo(() => new Map((symbolMetadata?.items ?? []).map((item) => [item.symbol, item])), [symbolMetadata]);
  const sectorOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of symbolMetadata?.items ?? []) {
      values.add(item.sector || (item.symbol.endsWith('.TO') ? 'Unknown sector (CA)' : 'Unknown'));
    }
    return ['All sectors', ...[...values].sort((a, b) => a.localeCompare(b))];
  }, [symbolMetadata]);

  const trades = useMemo<Array<InsiderFeedItem & { sector: string | null }>>(() => {
    const filtered = rawTrades.filter((trade) => {
      if (filterMode === 'buy') return trade.type === 'BUY';
      if (filterMode === 'sell') return trade.type === 'SELL';
      return true;
    }).filter((trade) => {
      if (sectorFilter === 'All sectors') return true;
      const fallbackSector = trade.symbol.endsWith('.TO') ? 'Unknown sector (CA)' : 'Unknown';
      return (metadataMap.get(trade.symbol)?.sector || fallbackSector) === sectorFilter;
    }).map((trade) => ({
      ...trade,
      sector: metadataMap.get(trade.symbol)?.sector || (trade.symbol.endsWith('.TO') ? 'Unknown sector (CA)' : null),
    }));

    return [...filtered].sort((a, b) => {
      if (sortMode === 'date') {
        return (b.filingDate || '').localeCompare(a.filingDate || '')
          || (b.transactionDate || '').localeCompare(a.transactionDate || '')
          || ((b.totalValue ?? 0) - (a.totalValue ?? 0));
      }
      return (b.totalValue ?? 0) - (a.totalValue ?? 0);
    });
  }, [filterMode, metadataMap, rawTrades, sectorFilter, sortMode]);

  const tabLabel = {
    us: 'US · SEC Form 4',
    'ca-insiders': 'CA · SEDI open-market',
    'ca-filings': 'CA · all SEDI filings',
  }[marketTab];

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            Insider Activity
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Broader insider coverage ranked by freshness or dollar value.
          </p>
          <DataStatus refreshing={isFetching} updatedAt={updatedAt} />
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {([
            { id: 'us', label: 'US Insiders' },
            { id: 'ca-insiders', label: 'CA Insiders' },
            { id: 'ca-filings', label: 'CA Filings' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMarketTab(tab.id)}
              style={{
                padding: '7px 16px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: marketTab === tab.id ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: marketTab === tab.id ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${marketTab === tab.id ? 'var(--accent-blue)' : 'var(--border-default)'}`,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
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
            {sectorOptions.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
        </div>

        {overview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
            <OverviewCard label="Market Read" value={formatSignalLabel(overview.market.signal)} tone={overview.market.signal} />
            <OverviewCard label="Net Flow" value={formatLargeNumber(overview.market.netValue)} tone={overview.market.netValue >= 0 ? 'net_buy' : 'net_sell'} />
            <OverviewCard label="Buy Value" value={formatLargeNumber(overview.market.buyValue)} tone="net_buy" />
            <OverviewCard label="Sell Value" value={formatLargeNumber(overview.market.sellValue)} tone="net_sell" />
            <OverviewCard label="Tax / Other" value={formatLargeNumber(overview.market.taxValue + overview.market.otherValue)} tone="tax_heavy" />
          </div>
        )}

        {overview && overview.bySymbol.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              Quick Read By Symbol
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {overview.bySymbol.slice(0, 8).map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => navigate(`/stock/${item.symbol}`)}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    borderRadius: 12,
                    padding: '9px 12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                    {item.symbol}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {formatSignalLabel(item.signal)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {item.tradeCount} trades · {formatLargeNumber(item.netValue)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {marketTab !== 'us' && isLoading && (
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: -12, marginBottom: 16 }}>
            Querying a broad Canadian symbol set via SEDI and TMX. First load can take longer.
          </p>
        )}

        {isLoading && rawTrades.length === 0 && <FeedSkeleton />}

        {error && rawTrades.length === 0 && (
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

        {rawTrades.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
                {tabLabel} · showing {trades.length} of {rawTrades.length} transactions · {days}D window
              </p>
              <DataStatus refreshing={isFetching} updatedAt={updatedAt} />
            </div>

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
                    }}
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
                          {trade.sector && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-hover)', color: 'var(--text-tertiary)' }}>
                              {trade.sector}
                            </span>
                          )}
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
                          <DataPoint label="Filed" value={trade.filingDate || trade.transactionDate} />
                          <DataPoint label="Traded" value={trade.transactionDate} />
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

function OverviewCard({ label, value, tone }: { label: string; value: string; tone?: string | null }) {
  const color = tone === 'net_buy' || tone === 'buy_skew'
    ? 'var(--color-up)'
    : tone === 'net_sell' || tone === 'sell_skew'
      ? 'var(--color-down)'
      : 'var(--text-primary)';

  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>
        {value}
      </div>
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
