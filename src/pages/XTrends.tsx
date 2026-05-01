import { useMemo, useState } from 'react';
import { ExternalLink, Search, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DataStatus } from '../components/ui/DataStatus';
import { useStockQuotes } from '../hooks/useStockData';
import { useXTrends } from '../hooks/useXTrends';
import type { XTrendItem } from '../api/xSocial';

const WINDOWS = [
  { hours: 24, label: '24H' },
  { hours: 72, label: '72H' },
  { hours: 168, label: '7D' },
];

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat([], { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat([], {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function tone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'var(--text-tertiary)';
  if (value > 0) return 'var(--color-up)';
  if (value < 0) return 'var(--color-down)';
  return 'var(--text-tertiary)';
}

function Pill({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 999,
      padding: '2px 6px',
      fontSize: 10,
      fontWeight: 800,
      color: accent ? '#111827' : 'var(--text-secondary)',
      background: accent ? '#facc15' : 'var(--bg-elevated)',
      border: `1px solid ${accent ? 'rgba(250,204,21,0.35)' : 'var(--border-subtle)'}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function TrendRow({ item, quote }: { item: XTrendItem; quote?: { c?: number; dp?: number } }) {
  return (
    <article
      className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_130px_120px_140px] gap-2 md:gap-4"
      style={{
        padding: '10px 11px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        background: 'var(--bg-surface)',
        alignItems: 'start',
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
          <Link
            to={`/stock/${item.symbol}`}
            style={{
              color: 'var(--text-primary)',
              fontSize: 16,
              fontWeight: 900,
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.symbol}
          </Link>
          <a
            href={`https://x.com/search?q=%24${encodeURIComponent(item.symbol)}&src=typed_query&f=live`}
            target="_blank"
            rel="noreferrer"
            title={`Open $${item.symbol} on X`}
            style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}
          >
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 7 }}>
          <Pill label={`${formatNumber(item.mentions)} mentions`} accent={item.mentions >= 3} />
          <Pill label={`${formatNumber(item.uniqueAccounts)} acct`} />
        </div>
      </div>

      <div>
        <p style={{ margin: '0 0 3px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-tertiary)' }}>Price</p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(quote?.c)}</p>
        <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 700, color: tone(quote?.dp) }}>
          {quote?.dp == null ? '-' : `${quote.dp > 0 ? '+' : ''}${quote.dp.toFixed(2)}%`}
        </p>
      </div>

      <div>
        <p style={{ margin: '0 0 3px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-tertiary)' }}>Engage</p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{formatNumber(item.engagementScore)}</p>
      </div>

      <div>
        <p style={{ margin: '0 0 3px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-tertiary)' }}>Latest</p>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatTime(item.latestPostAt)}</p>
      </div>
    </article>
  );
}

export default function XTrendsPage() {
  const [hours, setHours] = useState(72);
  const [query, setQuery] = useState('');
  const { data, error, isLoading, isFetching, dataUpdatedAt } = useXTrends({ hours, limit: 100 });

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const results = data?.results ?? [];
  const filteredResults = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return results;
    return results.filter((item) => item.symbol.includes(q));
  }, [query, results]);
  const quoteSymbols = useMemo(() => filteredResults.slice(0, 25).map((item) => item.symbol), [filteredResults]);
  const { quoteMap } = useStockQuotes(quoteSymbols);
  const mentionCount = filteredResults.reduce((sum, item) => sum + item.mentions, 0);

  return (
    <div className="px-2.5 sm:px-4 md:px-8 pt-3 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 10 }}>
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} style={{ color: '#facc15' }} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>X Trends</h1>
          </div>
          <p className="hidden md:block" style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 760 }}>
            Ticker mentions from the curated analyst and trader account list.
          </p>
        </div>
        <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
        {WINDOWS.map((option) => {
          const active = hours === option.hours;
          return (
            <button
              key={option.hours}
              onClick={() => setHours(option.hours)}
              style={{
                padding: '7px 11px',
                borderRadius: 999,
                border: `1px solid ${active ? 'rgba(250,204,21,0.45)' : 'var(--border-default)'}`,
                background: active ? 'rgba(250,204,21,0.15)' : 'var(--bg-elevated)',
                color: active ? '#facc15' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_92px_92px] md:grid-cols-[1fr_150px_150px] gap-2" style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '0 12px' }}>
          <Search size={15} style={{ color: 'var(--text-tertiary)' }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ticker"
            style={{ flex: 1, minWidth: 0, height: 40, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
          />
        </label>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '9px 10px' }}>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 800 }}>Tickers</p>
          <p style={{ margin: '1px 0 0', fontSize: 17, fontWeight: 900, color: 'var(--text-primary)' }}>{filteredResults.length}</p>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '9px 10px' }}>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 800 }}>Mentions</p>
          <p style={{ margin: '1px 0 0', fontSize: 17, fontWeight: 900, color: '#facc15' }}>{formatNumber(mentionCount)}</p>
        </div>
      </div>

      {data?.note && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 14, padding: 12, marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{data.note}</p>
        </div>
      )}

      {isLoading ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 20 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Loading X analyst trends...</p>
        </div>
      ) : error ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 18, padding: 18 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>X Trends could not be loaded right now.</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>{(error as Error).message}</p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 18 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>No X ticker mentions in this window</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>Run the X poll from admin or widen the time window.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-1 gap-2" style={{ alignItems: 'stretch' }}>
          <div className="hidden md:grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 130px 120px 140px', gap: 16, padding: '0 16px 8px', color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            <span>Ticker</span>
            <span>Price</span>
            <span>Engagement</span>
            <span>Latest</span>
          </div>
          {filteredResults.map((item) => <TrendRow key={item.symbol} item={item} quote={quoteMap[item.symbol]} />)}
        </div>
      )}
    </div>
  );
}
