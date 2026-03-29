import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, TrendingUp, TrendingDown, Clock, RefreshCw } from 'lucide-react';
import { getAllPlayers, getAllHoldings, getRecentTrades, supabase } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';
import type { Player, Holding, Trade } from '../api/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useStockQuote } from '../hooks/useStockData';
import { formatPrice } from '../utils/formatters';

const STARTING_CASH = 1000;

// ── Live price hook for a symbol ─────────────────────────────────────────────
function useLivePrice(symbol: string) {
  const { data } = useStockQuote(symbol);
  return data?.c ?? 0;
}

// ── Portfolio value calculator ───────────────────────────────────────────────
interface LeaderEntry {
  player: Player;
  holdings: Holding[];
  portfolioValue: number; // cash + holdings value (priced live)
  gainPct: number;
}

function RankBadge({ rank }: { rank: number }) {
  const colors = ['#F0A716', '#8A8F98', '#CD7F32'];
  const icons = ['🥇', '🥈', '🥉'];
  if (rank <= 3) return <span className="text-xl">{icons[rank - 1]}</span>;
  return (
    <span
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
    >
      {rank}
    </span>
  );
}

// One row — fetches live prices for each holding internally
function LeaderRow({
  entry, rank, isMe,
}: { entry: LeaderEntry; rank: number; isMe: boolean }) {
  const { player, holdings, portfolioValue, gainPct } = entry;
  const isUp = gainPct >= 0;

  return (
    <div
      className="flex items-center gap-3 px-4 py-4 rounded-2xl transition-colors"
      style={{
        background: isMe ? 'rgba(22,82,240,0.08)' : 'var(--bg-surface)',
        border: isMe ? '1px solid rgba(22,82,240,0.3)' : '1px solid var(--border-subtle)',
        marginBottom: 8,
      }}
    >
      <RankBadge rank={rank} />

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{ background: player.avatar_color, color: '#fff' }}
      >
        {player.name[0].toUpperCase()}
      </div>

      {/* Name + holdings preview */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {player.name}
          </span>
          {isMe && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ background: 'var(--accent-blue)', color: '#fff' }}>you</span>
          )}
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
          {holdings.length === 0
            ? 'No positions'
            : holdings.slice(0, 3).map(h => h.symbol).join(' · ')
              + (holdings.length > 3 ? ` +${holdings.length - 3}` : '')}
        </div>
      </div>

      {/* Value + gain */}
      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
          ${portfolioValue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div
          className="flex items-center justify-end gap-1 text-xs font-medium mt-0.5"
          style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}
        >
          {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {isUp ? '+' : ''}{gainPct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

// Activity feed item
function ActivityItem({ trade, playerName }: { trade: Trade & { player_name: string }; playerName: string }) {
  const isBuy = trade.trade_type === 'BUY';
  const ago = getTimeAgo(trade.traded_at);
  return (
    <div className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: isBuy ? 'var(--color-up)' : 'var(--color-down)' }}
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {trade.player_name}
        </span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {' '}{isBuy ? 'bought' : 'sold'}{' '}
          <Link
            to={`/stock/${trade.symbol}`}
            className="font-semibold"
            style={{ color: isBuy ? 'var(--color-up)' : 'var(--color-down)', textDecoration: 'none' }}
          >
            {trade.symbol}
          </Link>
        </span>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
          ${trade.total.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{ago}</div>
      </div>
    </div>
  );
}

function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Main Leaderboard page ─────────────────────────────────────────────────────
export default function Leaderboard() {
  const { player: me } = useLeagueStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [recentTrades, setRecentTrades] = useState<(Trade & { player_name: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(async () => {
    try {
      setError('');
      const [p, h, t] = await Promise.all([
        getAllPlayers(),
        getAllHoldings(),
        getRecentTrades(10),
      ]);
      setPlayers(p);
      setHoldings(h);
      setRecentTrades(t);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Leaderboard load failed', e);
      setError('Could not load leaderboard. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // Real-time subscriptions for live leaderboard
    const sub = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, load)
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [load]);

  // Build leaderboard entries (prices fetched per-symbol via existing hooks below)
  // We pass raw data to the renderer which uses LivePortfolioValue
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4 md:p-8 max-w-2xl mx-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(240,167,22,0.15)' }}
          >
            <Trophy size={20} style={{ color: '#F0A716' }} />
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              League
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Starting ${STARTING_CASH.toLocaleString()} · {players.length} players
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="rounded-2xl p-4 mb-2 flex items-center justify-between"
          style={{ background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-down)' }}>{error}</span>
          <button onClick={load} className="text-xs font-medium" style={{ color: 'var(--color-down)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}

      {/* Leaderboard — each entry gets live prices via LiveLeaderEntry */}
      <LiveLeaderboard players={players} allHoldings={holdings} meId={me?.id} />

      {/* Activity Feed */}
      {recentTrades.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Recent Activity
            </span>
          </div>
          <div
            className="rounded-2xl px-4"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            {recentTrades.map((t) => (
              <ActivityItem key={t.id} trade={t} playerName={t.player_name} />
            ))}
          </div>
        </div>
      )}

      {recentTrades.length === 0 && !loading && (
        <div className="mt-8 text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
          <p className="text-sm">No trades yet. Be the first to make a move!</p>
        </div>
      )}
    </div>
  );
}

// ── Live leaderboard with price fetching ──────────────────────────────────────
function LiveLeaderboard({
  players, allHoldings, meId,
}: { players: Player[]; allHoldings: Holding[]; meId?: string }) {
  // Collect unique symbols across all holdings
  const symbols = [...new Set(allHoldings.map(h => h.symbol))];

  // We render a component per symbol to trigger the quote hook
  // Then aggregate via a shared price map passed down
  return (
    <PriceMapLoader symbols={symbols} players={players} allHoldings={allHoldings} meId={meId} />
  );
}

function PriceMapLoader({
  symbols, players, allHoldings, meId,
}: { symbols: string[]; players: Player[]; allHoldings: Holding[]; meId?: string }) {
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});

  // Hooks can't be in loops — use a sub-component per symbol
  return (
    <>
      {symbols.map(sym => (
        <SymbolPriceFetcher key={sym} symbol={sym} onPrice={(s, p) =>
          setPriceMap(prev => ({ ...prev, [s]: p }))
        } />
      ))}
      <RankedList players={players} allHoldings={allHoldings} priceMap={priceMap} meId={meId} />
    </>
  );
}

function SymbolPriceFetcher({ symbol, onPrice }: { symbol: string; onPrice: (s: string, p: number) => void }) {
  const { data } = useStockQuote(symbol);
  useEffect(() => {
    if (data?.c) onPrice(symbol, data.c);
  }, [data?.c, symbol]);
  return null;
}

function RankedList({
  players, allHoldings, priceMap, meId,
}: { players: Player[]; allHoldings: Holding[]; priceMap: Record<string, number>; meId?: string }) {
  const entries: LeaderEntry[] = players.map(player => {
    const myHoldings = allHoldings.filter(h => h.player_id === player.id);
    const holdingsValue = myHoldings.reduce((sum, h) => {
      const price = priceMap[h.symbol] ?? h.avg_cost; // fallback to cost if price not loaded yet
      return sum + h.shares * price;
    }, 0);
    const portfolioValue = player.cash + holdingsValue;
    const gainPct = ((portfolioValue - STARTING_CASH) / STARTING_CASH) * 100;
    return { player, holdings: myHoldings, portfolioValue, gainPct };
  });

  entries.sort((a, b) => b.portfolioValue - a.portfolioValue);

  return (
    <div>
      {entries.map((entry, i) => (
        <LeaderRow key={entry.player.id} entry={entry} rank={i + 1} isMe={entry.player.id === meId} />
      ))}
    </div>
  );
}
