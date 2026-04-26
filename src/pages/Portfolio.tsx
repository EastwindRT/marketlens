import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, LogOut, Briefcase, Plus, Star } from 'lucide-react';
import { getHoldings, getPortfolioSnapshot, supabase } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';
import { useStockQuotes } from '../hooks/useStockData';
import type { Holding, Player } from '../api/supabase';
import { formatPrice } from '../utils/formatters';
import { useWatchlistStore } from '../store/watchlistStore';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import { DataStatus } from '../components/ui/DataStatus';

const AddPositionModal = lazy(() => import('../components/trade/AddPositionModal'));
const AddWatchlistModal = lazy(() => import('../components/trade/AddWatchlistModal'));

const portfolioCacheKey = (playerId: string) => `tars:portfolio-holdings:${playerId}`;

function readCachedHoldings(playerId: string): Holding[] {
  try {
    const raw = sessionStorage.getItem(portfolioCacheKey(playerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedHoldings(playerId: string, holdings: Holding[]) {
  try {
    sessionStorage.setItem(portfolioCacheKey(playerId), JSON.stringify(holdings));
  } catch {
    // Ignore cache-write failures; the live query is still the source of truth.
  }
}

const HoldingRow = React.memo(function HoldingRow({ holding, quote }: { holding: Holding; quote?: { c?: number } }) {
  const currentPrice = quote?.c ?? holding.avg_cost;
  const currentValue = currentPrice * holding.shares;
  const costBasis = holding.avg_cost * holding.shares;
  const gainLoss = currentValue - costBasis;
  const gainPct = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
  const isUp = gainLoss >= 0;

  return (
    <Link
      to={`/stock/${holding.symbol}`}
      className="flex items-center gap-3 px-4 py-4 rounded-2xl no-underline"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        marginBottom: 8,
        display: 'flex',
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      >
        {holding.symbol.replace('.TO', '').slice(0, 4)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          {holding.symbol}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {holding.shares} shares · avg {formatPrice(holding.avg_cost)}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
          {formatPrice(currentValue)}
        </div>
        <div
          className="flex items-center justify-end gap-0.5 text-xs font-medium mt-0.5"
          style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}
        >
          {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {isUp ? '+' : ''}{gainPct.toFixed(2)}%
        </div>
      </div>
    </Link>
  );
});

const WatchRow = React.memo(function WatchRow({ symbol, name, quote }: { symbol: string; name?: string; quote?: { c?: number; dp?: number } }) {
  const price = quote?.c;
  const changePct = quote?.dp ?? 0;
  const isUp = changePct >= 0;

  return (
    <Link
      to={`/stock/${symbol}`}
      className="flex items-center gap-3 px-4 py-4 rounded-2xl no-underline"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        marginBottom: 8,
        display: 'flex',
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      >
        {symbol.replace('.TO', '').slice(0, 4)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{symbol}</div>
        {name && <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{name}</div>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
          {price ? formatPrice(price) : '—'}
        </div>
        {price != null && (
          <div
            className="flex items-center justify-end gap-0.5 text-xs font-medium mt-0.5"
            style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}
          >
            {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {isUp ? '+' : ''}{changePct.toFixed(2)}%
          </div>
        )}
      </div>
    </Link>
  );
});

export default function Portfolio() {
  const { player, playerStatus, logout } = useLeagueStore();
  const { items: watchlist, hydrated: watchlistHydrated } = useWatchlistStore();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<'cached' | 'live'>('live');
  const hasLoadedRef = useRef(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  useEffect(() => {
    // Don't redirect — App.tsx handles the login wall for unauthenticated users.
    // Just wait for the player to be set after the session resolves.
    if (!player) return;
    const playerId = player.id;

    let isActive = true;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const cachedHoldings = readCachedHoldings(playerId);
    if (cachedHoldings.length > 0 && !hasLoadedRef.current) {
      setHoldings(cachedHoldings);
      setLoading(false);
      setLastUpdatedAt(Date.now());
      setDataSource('cached');
      hasLoadedRef.current = true;
    }

    async function load(showBlockingState: boolean) {
      const runId = ++requestId;
      try {
        if (showBlockingState && !hasLoadedRef.current) setLoading(true);
        else setRefreshing(true);
        if (showBlockingState || !hasLoadedRef.current) setLoadError('');
        let h: Holding[];
        try {
          const snapshot = await getPortfolioSnapshot(playerId);
          h = snapshot.holdings;
        } catch {
          h = await getHoldings(playerId);
        }
        if (!isActive || runId !== requestId) return;
        setHoldings(h);
        writeCachedHoldings(playerId, h);
        setLoadError('');
        setLastUpdatedAt(Date.now());
        setDataSource('live');
        hasLoadedRef.current = true;
      } catch {
        if (!isActive || runId !== requestId) return;
        if (!hasLoadedRef.current) setLoadError('Could not load holdings. Tap to retry.');
      } finally {
        if (!isActive || runId !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      }
    }
    void load(true);

    const sub = supabase
      .channel('portfolio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings',
        filter: `player_id=eq.${playerId}` }, () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { void load(false); }, 250);
        })
      .subscribe();

    return () => {
      isActive = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(sub);
    };
  }, [player]);

  const allSymbols = [...new Set([
    ...holdings.map((holding) => holding.symbol),
    ...watchlist.map((item) => item.symbol),
  ])];
  const { quoteMap } = useStockQuotes(allSymbols);

  // Show skeleton while session/player is still loading
  if (!player) {
    if (playerStatus === 'loading') return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <div className="h-10 w-48 rounded-2xl animate-pulse mb-6" style={{ background: 'var(--bg-surface)' }} />
        <div className="h-36 rounded-2xl animate-pulse mb-6" style={{ background: 'var(--bg-surface)' }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl animate-pulse mb-2" style={{ background: 'var(--bg-surface)' }} />
        ))}
      </div>
    );

    const isSlowBoot = playerStatus === 'timed_out';
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
        <div
          className="rounded-2xl p-6"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isSlowBoot ? 'Still connecting to your portfolio' : 'Could not load your profile'}
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            {isSlowBoot
              ? 'Your session is live, but player setup is taking longer than expected. This usually means auth or Supabase is responding slowly.'
              : 'The app could not match your signed-in session to a player row yet.'}
          </p>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Retry
            </button>
            <button
              onClick={() => navigate('/leaderboard')}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
            >
              View portfolios
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-base font-bold"
            style={{ background: player.avatar_color, color: '#fff' }}
          >
            {player.name[0].toUpperCase()}
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {player.display_name || player.name}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>My Portfolio</p>
            <DataStatus refreshing={refreshing} updatedAt={lastUpdatedAt} source={dataSource} />
          </div>
        </div>
        <button
          onClick={() => { void handleLogout(); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>

      <ErrorBoundary label="portfolio:summary" compact>
        <PortfolioSummary player={player} holdings={holdings} quoteMap={quoteMap} />
      </ErrorBoundary>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Briefcase size={14} style={{ color: 'var(--text-tertiary)' }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Positions
            </span>
          </div>
          <button
            onClick={() => setShowAddPosition(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{
              background: 'var(--accent-blue)', color: '#fff',
              border: 'none', cursor: 'pointer',
            }}
          >
            <Plus size={13} />
            Add position
          </button>
        </div>

        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl animate-pulse mb-2" style={{ background: 'var(--bg-surface)' }} />
          ))
        ) : loadError ? (
          <div
            className="rounded-2xl p-5 text-center"
            style={{ background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-down)' }}>{loadError}</p>
          </div>
        ) : holdings.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No positions yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Add a stock you own — pick market price or enter your actual entry
            </p>
            <button
              onClick={() => setShowAddPosition(true)}
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={14} /> Add your first position
            </button>
          </div>
        ) : (
          <ErrorBoundary label="portfolio:holdings" compact>
            {holdings.map(h => <HoldingRow key={h.id} holding={h} quote={quoteMap[h.symbol]} />)}
          </ErrorBoundary>
        )}
      </div>

      {/* ── Watchlist ── */}
      {watchlistHydrated && watchlist.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Star size={14} style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Watchlist
              </span>
            </div>
            <button
              onClick={() => setShowAddWatchlist(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
            >
              <Plus size={13} />
              Add symbol
            </button>
          </div>
          <ErrorBoundary label="portfolio:watchlist" compact>
            {watchlist.map(item => (
              <WatchRow key={item.symbol} symbol={item.symbol} name={item.name} quote={quoteMap[item.symbol]} />
            ))}
          </ErrorBoundary>
        </div>
      )}

      {watchlistHydrated && watchlist.length === 0 && (
        <div
          className="mt-6 rounded-2xl p-8 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex justify-center mb-3">
            <Star size={20} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No watchlist items yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Add symbols here to track price moves without opening each stock first.
          </p>
          <button
            onClick={() => setShowAddWatchlist(true)}
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <Plus size={14} /> Add your first watchlist item
          </button>
        </div>
      )}

      {!watchlistHydrated && (
        <div className="mt-6">
          <div className="h-28 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        </div>
      )}

      <Suspense fallback={null}>
        {showAddPosition && (
          <AddPositionModal onClose={() => setShowAddPosition(false)} />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {showAddWatchlist && (
          <AddWatchlistModal onClose={() => setShowAddWatchlist(false)} />
        )}
      </Suspense>
    </div>
  );
}

function PortfolioSummary({ player, holdings, quoteMap }: { player: Player; holdings: Holding[]; quoteMap: Record<string, { c?: number } | undefined> }) {
  const holdingsValue = holdings.reduce((sum, h) => {
    const price = quoteMap[h.symbol]?.c ?? h.avg_cost;
    return sum + h.shares * price;
  }, 0);

  const costBasis = holdings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
  return <SummaryCard player={player} holdingsValue={holdingsValue} costBasis={costBasis} holdingsCount={holdings.length} />;
}

function SummaryCard({ holdingsValue, costBasis, holdingsCount }: {
  player: Player;
  holdingsValue: number;
  costBasis: number;
  holdingsCount: number;
}) {
  const gain = holdingsValue - costBasis;
  const gainPct = costBasis > 0 ? (gain / costBasis) * 100 : 0;
  const isUp = gain >= 0;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
    >
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
        PORTFOLIO VALUE
      </div>
      <div className="font-mono font-bold text-3xl" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        ${holdingsValue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div
        className="flex items-center gap-1 mt-1 text-sm font-medium"
        style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}
      >
        {isUp ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
        {isUp ? '+' : ''}{formatPrice(Math.abs(gain))} ({isUp ? '+' : ''}{gainPct.toFixed(2)}%)
      </div>

      <div
        className="grid grid-cols-2 gap-3 mt-4 pt-4"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cost Basis</div>
          <div className="font-mono font-semibold text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(costBasis)}
          </div>
        </div>
        <div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Positions</div>
          <div className="font-mono font-semibold text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {holdingsCount}
          </div>
        </div>
      </div>
    </div>
  );
}
