import { useNavigate } from 'react-router-dom';
import { useWatchlistStore } from '../store/watchlistStore';
import { useStockQuote } from '../hooks/useStockData';
import { formatPrice, formatChange } from '../utils/formatters';
import { formatTicker, isTSXTicker } from '../utils/marketHours';
import { TrendingUp, TrendingDown } from 'lucide-react';

function DashboardCard({ symbol, name }: { symbol: string; name?: string }) {
  const navigate = useNavigate();
  const { data: quote, isLoading } = useStockQuote(symbol);
  const isUp = (quote?.dp ?? 0) >= 0;
  const currency = isTSXTicker(symbol) ? 'CAD' : 'USD';

  return (
    <div
      className="rounded-2xl p-5 cursor-pointer transition-all"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        transition: 'all 150ms ease-out',
      }}
      onClick={() => navigate(`/stock/${symbol}`)}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-elevated)';
        e.currentTarget.style.borderColor = 'var(--border-default)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-surface)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatTicker(symbol)}</div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)', maxWidth: 140 }}>{name}</div>
        </div>
        <div style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}>
          {isUp ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <div className="skeleton h-7 w-24 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
      ) : (
        <>
          <div
            className="text-2xl font-semibold mono"
            style={{ color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}
          >
            {quote ? formatPrice(quote.c, currency) : '—'}
          </div>
          <div
            className="text-sm font-medium mono mt-1"
            style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)', fontFamily: "'Roboto Mono', monospace" }}
          >
            {quote ? formatChange(quote.dp) : '—'}
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { items } = useWatchlistStore();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Your watchlist at a glance</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map(item => (
          <DashboardCard key={item.symbol} symbol={item.symbol} name={item.name} />
        ))}
      </div>
    </div>
  );
}
