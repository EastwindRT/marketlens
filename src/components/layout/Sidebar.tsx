import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { Minus, Star, X, Trophy, Users, TrendingUp, TrendingDown, Shield, User, Newspaper, Building2, Briefcase, CircleDollarSign, Plus, Bell, MessageCircle, AtSign } from 'lucide-react';

const AddPositionModal = lazy(() => import('../trade/AddPositionModal'));
import { useWatchlistStore } from '../../store/watchlistStore';
import { useLeagueStore } from '../../store/leagueStore';
import { useStockQuotes } from '../../hooks/useStockData';
import { getAllPlayers, getAllHoldings } from '../../api/supabase';
import { formatPrice } from '../../utils/formatters';
import { formatTicker } from '../../utils/marketHours';
import type { Player, Holding } from '../../api/supabase';

type SidebarQuote = { c?: number; dp?: number } | undefined;

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

const ADMIN_EMAILS: string[] = (import.meta.env.VITE_ADMIN_EMAILS ?? 'renjith914@gmail.com')
  .split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);

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

// ── Player row ────────────────────────────────────────────────────────────────
function PlayerRow({ player, rank, positions, isMe, onClose }: {
  player: Player; rank: number; positions: number; isMe: boolean; onClose?: () => void;
}) {
  const navigate = useNavigate();
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
      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'Roboto Mono, monospace', color: 'var(--text-tertiary)', flexShrink: 0 }}>
        {positions} pos
      </span>
    </div>
  );
}

// ── S&P mover row ─────────────────────────────────────────────────────────────
function MoverRow({ symbol, quote, onClose }: { symbol: string; quote?: SidebarQuote; onClose?: () => void }) {
  const navigate = useNavigate();
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

// ── Main Sidebar ──────────────────────────────────────────────────────────────
interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const { items } = useWatchlistStore();
  const { player: me } = useLeagueStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [showAddPosition, setShowAddPosition] = useState(false);

  // Single batched quote fetch for everything the sidebar shows live prices for
  // (S&P movers + watchlist). Replaces the previous recursive 1-hook-per-symbol
  // SpMoverChain pattern and per-row useStockQuote calls in WatchlistItem/MoverRow.
  const watchlistSymbols = useMemo(() => items.map(i => i.symbol), [items]);
  const sidebarSymbols = useMemo(
    () => Array.from(new Set([...SP_SYMBOLS, ...watchlistSymbols])),
    [watchlistSymbols],
  );
  const { quoteMap } = useStockQuotes(sidebarSymbols);

  const topMovers = useMemo(() => {
    const scored = SP_SYMBOLS
      .map(sym => ({ sym, pct: quoteMap[sym]?.dp ?? 0, hasQuote: !!quoteMap[sym]?.c }))
      .filter(x => x.hasQuote);
    if (scored.length === 0) return SP_SYMBOLS.slice(0, 5);
    return scored
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 5)
      .map(x => x.sym);
  }, [quoteMap]);

  // Check admin — player name matches 'eastwind' (case-insensitive)
  const isAdmin = !!me?.google_email && ADMIN_EMAILS.includes(me.google_email.toLowerCase());

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    Promise.all([getAllPlayers(), getAllHoldings()])
      .then(([p, h]) => { setPlayers(p); setHoldings(h); })
      .catch(() => {});
  }, [me]);

  // Players list (no live prices in sidebar — rank by # positions as proxy)
  const rankedPlayers = players
    .map(p => {
      const myH = holdings.filter(h => h.player_id === p.id);
      const positions = myH.length;
      return { player: p, gainPct: 0, positions };
    })
    .sort((a, b) => b.positions - a.positions);

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
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>TARS</span>
        {onClose && (
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        )}
      </div>

      <Divider />

      {/* ── Portfolio nav ── */}
      {SUPABASE_CONFIGURED && (
        <>
          <NavLink to="/leaderboard" icon={<Trophy size={14} />} label="Portfolios" onClose={onClose} />
          {me && (
            <>
              <NavLink to="/portfolio" icon={<User size={14} />} label="My Portfolio" onClose={onClose} />
              <div style={{ padding: '2px 8px 8px' }}>
                <button
                  onClick={() => setShowAddPosition(true)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', borderRadius: 10, cursor: 'pointer',
                    background: 'var(--accent-blue)', color: '#fff',
                    border: 'none', fontSize: 12, fontWeight: 600,
                  }}
                >
                  <Plus size={13} /> Add Position
                </button>
              </div>
            </>
          )}
          {isAdmin && <NavLink to="/admin" icon={<Shield size={14} />} label="Admin" onClose={onClose} />}
          <Divider />
        </>
      )}

      {/* ── Market nav — always visible ── */}
      <NavLink to="/news-impact" icon={<Newspaper size={14} />} label="News" onClose={onClose} />
      <NavLink to="/alerts"   icon={<Bell size={14} />}       label="Alerts" onClose={onClose} />
      <NavLink to="/x-trends" icon={<AtSign size={14} />} label="X Trends" onClose={onClose} />
      <NavLink to="/reddit-trends" icon={<MessageCircle size={14} />} label="Reddit Trends" onClose={onClose} />
      <NavLink to="/news"     icon={<Newspaper size={14} />}  label="Market Signals" onClose={onClose} />
      <NavLink to="/insiders" icon={<CircleDollarSign size={14} />} label="Insider $" onClose={onClose} />
      <NavLink to="/congress" icon={<Building2 size={14} />}  label="Congress Trades" onClose={onClose} />
      <NavLink to="/funds"    icon={<Briefcase size={14} />}  label="Fund Changes" onClose={onClose} />

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
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No watchlist items yet</p>
        </div>
      ) : (
        <div style={{ padding: '0 4px' }}>
          {items.map(item => (
            <WatchlistItem key={item.symbol} symbol={item.symbol} name={item.name} quote={quoteMap[item.symbol]} onClose={onClose} />
          ))}
        </div>
      )}

      <Divider />

      {/* ── Players ── */}
      {SUPABASE_CONFIGURED && rankedPlayers.length > 0 && (
        <>
          <SectionHeader icon={<Users size={11} />} label="Members" />
          {rankedPlayers.map(({ player, positions }, i) => (
            <PlayerRow
              key={player.id}
              player={player}
              rank={i + 1}
              positions={positions}
              isMe={player.id === me?.id}
              onClose={onClose}
            />
          ))}
          <Divider />
        </>
      )}

      {/* ── S&P Top Movers ── */}
      <SectionHeader icon={<TrendingUp size={11} />} label="S&P Movers" />
      {topMovers.map(sym => (
        <MoverRow key={sym} symbol={sym} quote={quoteMap[sym]} onClose={onClose} />
      ))}

      <div style={{ height: 24 }} />

      <Suspense fallback={null}>
        {showAddPosition && (
          <AddPositionModal onClose={() => setShowAddPosition(false)} />
        )}
      </Suspense>
    </aside>
  );
}
