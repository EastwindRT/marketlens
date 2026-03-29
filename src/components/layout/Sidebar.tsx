import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { Minus, Star, X, Trophy, Users, TrendingUp, TrendingDown, Shield, User, Newspaper } from 'lucide-react';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useLeagueStore } from '../../store/leagueStore';
import { useStockQuote } from '../../hooks/useStockData';
import { getAllPlayers, getAllHoldings } from '../../api/supabase';
import { formatPrice } from '../../utils/formatters';
import { formatTicker } from '../../utils/marketHours';
import type { Player, Holding } from '../../api/supabase';

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN ?? 'eastwind2025';
const STARTING_CASH = 1000;

// Curated S&P 500 movers list — well-known, high-volume stocks
const SP_SYMBOLS = ['NVDA', 'TSLA', 'META', 'AMZN', 'GOOGL', 'AAPL', 'MSFT', 'AMD', 'JPM', 'BAC'];

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

// ── Player row ────────────────────────────────────────────────────────────────
function PlayerRow({ player, rank, gainPct, isMe, onClose }: {
  player: Player; rank: number; gainPct: number; isMe: boolean; onClose?: () => void;
}) {
  const navigate = useNavigate();
  const isUp = gainPct >= 0;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', margin: '0 4px 1px', borderRadius: 10, cursor: 'pointer',
        background: isMe ? 'rgba(22,82,240,0.06)' : 'transparent',
        borderLeft: isMe ? '2px solid var(--accent-blue)' : '2px solid transparent',
        transition: 'background 100ms',
      }}
      onClick={() => { navigate(isMe ? '/portfolio' : `/portfolio/${player.id}`); onClose?.(); }}
      onMouseEnter={e => { if (!isMe) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!isMe) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 13, width: 20, textAlign: 'center', flexShrink: 0 }}>
        {medal ?? <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>{rank}</span>}
      </span>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        background: player.avatar_color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700,
      }}>
        {player.name[0].toUpperCase()}
      </div>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.name}
        {isMe && <span style={{ marginLeft: 4, fontSize: 9, background: 'var(--accent-blue)', color: '#fff', padding: '1px 4px', borderRadius: 99 }}>you</span>}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'Roboto Mono, monospace', color: isUp ? 'var(--color-up)' : 'var(--color-down)', flexShrink: 0 }}>
        {isUp ? '+' : ''}{gainPct.toFixed(1)}%
      </span>
    </div>
  );
}

// ── S&P mover row ─────────────────────────────────────────────────────────────
function MoverRow({ symbol, onClose }: { symbol: string; onClose?: () => void }) {
  const navigate = useNavigate();
  const { data: quote } = useStockQuote(symbol);
  if (!quote?.c) return null;
  const isUp = (quote.dp ?? 0) >= 0;
  const pct = quote.dp ?? 0;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', margin: '0 4px 1px', borderRadius: 10, cursor: 'pointer',
        transition: 'background 100ms',
      }}
      onClick={() => { navigate(`/stock/${symbol}`); onClose?.(); }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isUp
          ? <TrendingUp size={12} style={{ color: 'var(--color-up)' }} />
          : <TrendingDown size={12} style={{ color: 'var(--color-down)' }} />}
      </div>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</span>
      <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', color: 'var(--text-secondary)', marginRight: 6 }}>
        ${quote.c.toFixed(2)}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}>
        {isUp ? '+' : ''}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

// Fetches quotes for all SP_SYMBOLS and returns sorted movers (invisible component)
function SpMoversFetcher({ onReady }: { onReady: (sorted: string[]) => void }) {
  const quotes = SP_SYMBOLS.map(s => ({ symbol: s, pct: 0 }));
  // We can't call hooks in a loop — use a sub-component chain
  return <SpMoverChain symbols={SP_SYMBOLS} results={{}} onReady={onReady} />;
}

function SpMoverChain({
  symbols, results, onReady,
}: { symbols: string[]; results: Record<string, number>; onReady: (sorted: string[]) => void }) {
  const [sym, ...rest] = symbols;
  const { data: quote } = useStockQuote(sym ?? '');

  useEffect(() => {
    if (!sym) return;
    const pct = quote?.dp ?? 0;
    const updated = { ...results, [sym]: pct };
    if (rest.length === 0) {
      // All fetched — sort and emit top 5 by absolute % move
      const sorted = Object.entries(updated)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5)
        .map(([s]) => s);
      onReady(sorted);
    }
  }, [quote?.dp]);

  if (!sym) return null;
  if (rest.length === 0) return null;
  return <SpMoverChain symbols={rest} results={{ ...results, [sym]: quote?.dp ?? 0 }} onReady={onReady} />;
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const { items } = useWatchlistStore();
  const { player: me } = useLeagueStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [topMovers, setTopMovers] = useState<string[]>([]);

  // Check admin — player name matches 'eastwind' (case-insensitive)
  const isAdmin = !!me && me.name.toLowerCase() === 'eastwind';

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    Promise.all([getAllPlayers(), getAllHoldings()])
      .then(([p, h]) => { setPlayers(p); setHoldings(h); })
      .catch(() => {});
  }, [me]);

  // Build ranked player list (no live prices for sidebar — use avg_cost as proxy)
  const rankedPlayers = players
    .map(p => {
      const myH = holdings.filter(h => h.player_id === p.id);
      const invested = myH.reduce((s, h) => s + h.shares * h.avg_cost, 0);
      const total = p.cash + invested;
      const gainPct = ((total - STARTING_CASH) / STARTING_CASH) * 100;
      return { player: p, gainPct };
    })
    .sort((a, b) => b.gainPct - a.gainPct);

  return (
    <aside style={{
      width: 252, height: '100%', flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* ── Top bar with close (mobile only) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 4px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>MoneyTalks</span>
        {onClose && (
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        )}
      </div>

      <Divider />

      {/* ── League nav ── */}
      {SUPABASE_CONFIGURED && (
        <>
          <SectionHeader icon={<Trophy size={11} />} label="League" />
          <NavLink to="/leaderboard" icon={<Trophy size={14} />} label="Leaderboard" onClose={onClose} />
          {me && <NavLink to="/portfolio" icon={<User size={14} />} label="My Portfolio" onClose={onClose} />}
          {isAdmin && <NavLink to="/admin" icon={<Shield size={14} />} label="Admin" onClose={onClose} />}
          <Divider />
        </>
      )}

      {/* ── Market Signals — always visible ── */}
      <NavLink to="/news" icon={<Newspaper size={14} />} label="Market Signals" onClose={onClose} />

      {/* ── Watchlist ── */}
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
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Search for stocks to add</p>
        </div>
      ) : (
        <div style={{ padding: '0 4px' }}>
          {items.map(item => (
            <WatchlistItem key={item.symbol} symbol={item.symbol} name={item.name} onClose={onClose} />
          ))}
        </div>
      )}

      <Divider />

      {/* ── Players ── */}
      {SUPABASE_CONFIGURED && rankedPlayers.length > 0 && (
        <>
          <SectionHeader icon={<Users size={11} />} label="Players" />
          {rankedPlayers.map(({ player, gainPct }, i) => (
            <PlayerRow
              key={player.id}
              player={player}
              rank={i + 1}
              gainPct={gainPct}
              isMe={player.id === me?.id}
              onClose={onClose}
            />
          ))}
          <Divider />
        </>
      )}

      {/* ── S&P Top Movers ── */}
      <SectionHeader icon={<TrendingUp size={11} />} label="S&P Movers" />
      {topMovers.length > 0
        ? topMovers.map(sym => <MoverRow key={sym} symbol={sym} onClose={onClose} />)
        : SP_SYMBOLS.slice(0, 5).map(sym => <MoverRow key={sym} symbol={sym} onClose={onClose} />)
      }

      {/* Invisible fetcher to sort movers by actual % move */}
      <div style={{ display: 'none' }}>
        <SpMoversFetcher onReady={setTopMovers} />
      </div>

      <div style={{ height: 24 }} />
    </aside>
  );
}
