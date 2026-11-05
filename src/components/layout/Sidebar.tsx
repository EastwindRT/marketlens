import { useMemo } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { Minus, Star, X, Newspaper, Building2, CircleDollarSign, Radar, Layers } from 'lucide-react';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useStockQuotes } from '../../hooks/useStockData';
import { formatPrice } from '../../utils/formatters';
import { formatTicker } from '../../utils/marketHours';

type SidebarQuote = { c?: number; dp?: number } | undefined;

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, label, right }: { icon: React.ReactNode; label: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 16px 8px' }}>
      <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', flex: 1 }}>
        {label}
      </span>
      {right}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 16px' }} />;
}

// ── Watchlist item ────────────────────────────────────────────────────────────
function WatchlistItem({ symbol, name, quote, onClose }: { symbol: string; name?: string; quote?: SidebarQuote; onClose?: () => void }) {
  const navigate = useNavigate();
  const { symbol: currentSymbol } = useParams();
  const removeItem = useWatchlistStore(s => s.removeItem);
  const isActive = currentSymbol === symbol;
  const isUp = (quote?.dp ?? 0) >= 0;
  const pct = quote?.dp ?? 0;

  return (
    <div
      className="group"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px', marginBottom: 1, borderRadius: 10, cursor: 'pointer',
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        border: `1px solid ${isActive ? 'var(--border-default)' : 'transparent'}`,
        transition: 'background 100ms',
      }}
      onClick={() => { navigate(`/stock/${symbol}`); onClose?.(); }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isActive ? 'var(--accent-blue)' : 'var(--bg-elevated)',
        color: isActive ? '#fff' : 'var(--text-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em',
      }}>
        {formatTicker(symbol).slice(0, 2)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatTicker(symbol)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'Roboto Mono, monospace', color: isUp ? 'var(--color-up)' : 'var(--color-down)', marginLeft: 4, flexShrink: 0 }}>
            {quote ? (isUp ? '+' : '') + pct.toFixed(2) + '%' : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name || symbol}
          </span>
          <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', color: 'var(--text-secondary)', marginLeft: 4, flexShrink: 0 }}>
            {quote ? formatPrice(quote.c, symbol.includes('.TO') ? 'CAD' : 'USD') : '—'}
          </span>
        </div>
      </div>

      <button
        className="opacity-0 group-hover:opacity-100"
        style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
          cursor: 'pointer', color: 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 150ms',
        }}
        onClick={e => { e.stopPropagation(); removeItem(symbol); }}
      >
        <Minus size={9} />
      </button>
    </div>
  );
}

// ── Nav link ──────────────────────────────────────────────────────────────────
function NavLink({ to, icon, label, onClose }: { to: string; icon: React.ReactNode; label: string; onClose?: () => void }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <Link
      to={to}
      onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', margin: '0 4px 1px', borderRadius: 10,
        textDecoration: 'none',
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: 600,
        transition: 'background 100ms',
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
    >
      <span style={{ opacity: isActive ? 1 : 0.7 }}>{icon}</span>
      {label}
    </Link>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const { items } = useWatchlistStore();
  const watchlistSymbols = useMemo(() => items.map(i => i.symbol), [items]);
  const { quoteMap } = useStockQuotes(watchlistSymbols);

  return (
    <aside style={{
      width: 252, height: '100%', flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 4px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>TARS</span>
        {onClose && (
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        )}
      </div>

      <Divider />

      <SectionHeader icon={<Radar size={11} />} label="Filings" />
      <NavLink to="/filings" icon={<Layers size={14} />} label="All Filings" onClose={onClose} />
      <NavLink to="/ownership-filings" icon={<Radar size={14} />} label="13D/13G Triage" onClose={onClose} />
      <NavLink to="/news" icon={<Newspaper size={14} />} label="13D/13G Feed" onClose={onClose} />
      <NavLink to="/insiders" icon={<CircleDollarSign size={14} />} label="Insider $" onClose={onClose} />
      <NavLink to="/congress" icon={<Building2 size={14} />} label="Congress Trades" onClose={onClose} />

      <Divider />

      <SectionHeader
        icon={<Star size={11} />}
        label="Watchlist"
        right={
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
            {items.length}
          </span>
        }
      />
      {items.length === 0 ? (
        <div style={{ padding: '12px 16px 8px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No watchlist items yet</p>
        </div>
      ) : (
        <div style={{ padding: '0 4px' }}>
          {items.map(item => (
            <WatchlistItem key={item.symbol} symbol={item.symbol} name={item.name} quote={quoteMap[item.symbol]} onClose={onClose} />
          ))}
        </div>
      )}

      <div style={{ height: 24 }} />
    </aside>
  );
}
