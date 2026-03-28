import { useNavigate, useParams } from 'react-router-dom';
import { Minus, Star, X } from 'lucide-react';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useStockQuote } from '../../hooks/useStockData';
import { formatPrice } from '../../utils/formatters';
import { formatTicker } from '../../utils/marketHours';

function WatchlistItem({ symbol, name, onClose }: { symbol: string; name?: string; onClose?: () => void }) {
  const navigate = useNavigate();
  const { symbol: currentSymbol } = useParams();
  const { data: quote } = useStockQuote(symbol);
  const removeItem = useWatchlistStore(s => s.removeItem);
  const isActive = currentSymbol === symbol;
  const isUp = (quote?.dp ?? 0) >= 0;
  const pct = quote?.dp ?? 0;

  return (
    <div
      className="group flex items-center gap-3 px-3 rounded-xl cursor-pointer transition-all relative"
      style={{
        minHeight: 44,
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        border: `1px solid ${isActive ? 'var(--border-default)' : 'transparent'}`,
        marginBottom: 2,
      }}
      onClick={() => { navigate(`/stock/${symbol}`); onClose?.(); }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Ticker avatar */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold"
        style={{
          background: isActive ? 'var(--accent-blue)' : 'var(--bg-elevated)',
          color: isActive ? '#fff' : 'var(--text-secondary)',
          letterSpacing: '-0.02em',
        }}
      >
        {formatTicker(symbol).slice(0, 2)}
      </div>

      {/* Name + price */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {formatTicker(symbol)}
          </span>
          <span
            className="text-xs font-semibold mono ml-2 flex-shrink-0"
            style={{
              color: isUp ? 'var(--color-up)' : 'var(--color-down)',
              fontFamily: "'Roboto Mono', monospace",
            }}
          >
            {quote ? (isUp ? '+' : '') + pct.toFixed(2) + '%' : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
            {name || symbol}
          </span>
          <span
            className="text-xs mono ml-2 flex-shrink-0"
            style={{ color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}
          >
            {quote ? formatPrice(quote.c, symbol.includes('.TO') ? 'CAD' : 'USD') : '—'}
          </span>
        </div>
      </div>

      {/* Remove button */}
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
        }}
        onClick={e => { e.stopPropagation(); removeItem(symbol); }}
      >
        <Minus size={9} />
      </button>
    </div>
  );
}

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const { items } = useWatchlistStore();

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{
        width: 252,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        height: '100%',
      }}
    >
      {/* Section label */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Star size={12} style={{ color: 'var(--text-tertiary)' }} />
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.1em' }}
          >
            Watchlist
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
          >
            {items.length}
          </span>
          {/* Close button — only shown in mobile drawer */}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close watchlist"
              className="ml-auto flex items-center justify-center rounded-lg"
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div
        className="mx-4 mb-3"
        style={{ height: 1, background: 'var(--border-subtle)' }}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <Star size={20} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }} />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No stocks in watchlist
            </p>
          </div>
        ) : (
          items.map(item => (
            <WatchlistItem key={item.symbol} symbol={item.symbol} name={item.name} onClose={onClose} />
          ))
        )}
      </div>
    </aside>
  );
}
