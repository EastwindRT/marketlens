import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Clock, RotateCcw } from 'lucide-react';
import { getAllPlayers, getAllHoldings, getRecentTrades, supabase } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';
import type { Player, Holding, Trade } from '../api/supabase';
import { useStockQuotes } from '../hooks/useStockData';

// Cash system removed — returns are now computed as (holdings value − cost basis) / cost basis

// ── Time ago ─────────────────────────────────────────────────────────────────
function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      }}
    >
      {name[0].toUpperCase()}
    </div>
  );
}

// ── Podium card (top 3) ───────────────────────────────────────────────────────
const PodiumCard = React.memo(function PodiumCard({
  entry, rank, isMe,
}: { entry: LeaderEntry; rank: 1 | 2 | 3; isMe: boolean }) {
  const { player, portfolioValue, gainPct } = entry;
  const isUp = gainPct >= 0;
  const navigate = useNavigate();

  const medalEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  const scale = rank === 1 ? 1 : 0.88;
  const topOffset = rank === 1 ? 0 : 20;

  return (
    <div
      onClick={() => navigate(isMe ? '/portfolio' : `/portfolio/${player.id}`)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        marginTop: topOffset,
        transform: `scale(${scale})`,
        transformOrigin: 'bottom center',
        opacity: rank === 1 ? 1 : 0.85,
        cursor: 'pointer',
      }}
    >
      {/* Rank 1 gets a crown glow */}
      {rank === 1 && (
        <div style={{ fontSize: 24, lineHeight: 1 }}>👑</div>
      )}

      <div style={{ position: 'relative' }}>
        <Avatar name={player.name} color={player.avatar_color} size={rank === 1 ? 56 : 44} />
        {isMe && (
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 16, height: 16, borderRadius: '50%',
            background: 'var(--accent-blue)',
            border: '2px solid var(--bg-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} />
        )}
      </div>

      <span style={{ fontSize: 18 }}>{medalEmoji}</span>

      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: rank === 1 ? 13 : 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          maxWidth: 80,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {player.name.split(' ')[0]}
        </div>
        <div style={{
          fontFamily: 'Roboto Mono, monospace',
          fontSize: rank === 1 ? 13 : 11,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginTop: 2,
        }}>
          ${portfolioValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: isUp ? 'var(--color-up)' : 'var(--color-down)',
        }}>
          {isUp ? '+' : ''}{gainPct.toFixed(1)}%
        </div>
      </div>

      {/* Podium base */}
      <div style={{
        width: '100%',
        background: rank === 1
          ? 'linear-gradient(180deg, rgba(240,167,22,0.2) 0%, rgba(240,167,22,0.05) 100%)'
          : 'var(--bg-surface)',
        border: `1px solid ${rank === 1 ? 'rgba(240,167,22,0.3)' : 'var(--border-subtle)'}`,
        borderRadius: '12px 12px 0 0',
        height: rank === 1 ? 48 : rank === 2 ? 32 : 20,
        marginTop: 4,
      }} />
    </div>
  );
});

// ── Leaderboard row (rank 4+) ─────────────────────────────────────────────────
const LeaderRow = React.memo(function LeaderRow({ entry, rank, isMe }: { entry: LeaderEntry; rank: number; isMe: boolean }) {
  const { player, holdings, portfolioValue, gainPct } = entry;
  const isUp = gainPct >= 0;
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(isMe ? '/portfolio' : `/portfolio/${player.id}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: isMe ? 'rgba(22,82,240,0.06)' : 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
        borderLeft: isMe ? '2px solid var(--accent-blue)' : '2px solid transparent',
        cursor: 'pointer',
      }}
    >
      <span style={{
        width: 24, textAlign: 'center', flexShrink: 0,
        fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)',
      }}>
        {rank}
      </span>

      <Avatar name={player.name} color={player.avatar_color} size={34} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.name}
          </span>
          {isMe && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 99,
              background: 'var(--accent-blue)', color: '#fff', fontWeight: 600,
            }}>you</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {holdings.length === 0
            ? 'No positions'
            : holdings.slice(0, 3).map(h => h.symbol).join(' · ') + (holdings.length > 3 ? ` +${holdings.length - 3}` : '')}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          ${portfolioValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3,
          fontSize: 11, fontWeight: 600, marginTop: 2,
          color: isUp ? 'var(--color-up)' : 'var(--color-down)',
        }}>
          {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {isUp ? '+' : ''}{gainPct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
});

// ── Activity item ─────────────────────────────────────────────────────────────
const ActivityItem = React.memo(function ActivityItem({ trade }: { trade: Trade & { player_name: string } }) {
  const isBuy = trade.trade_type === 'BUY';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: isBuy ? 'var(--color-up)' : 'var(--color-down)',
      }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{trade.player_name}</span>
        {' '}{isBuy ? 'bought' : 'sold'}{' '}
        <Link to={`/stock/${trade.symbol}`} style={{
          fontWeight: 700,
          color: isBuy ? 'var(--color-up)' : 'var(--color-down)',
          textDecoration: 'none',
        }}>
          {trade.symbol}
        </Link>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 12, fontFamily: 'Roboto Mono, monospace', color: 'var(--text-secondary)' }}>
          ${trade.total.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{getTimeAgo(trade.traded_at)}</div>
      </div>
    </div>
  );
});

// ── Types ─────────────────────────────────────────────────────────────────────
interface LeaderEntry {
  player: Player;
  holdings: Holding[];
  portfolioValue: number;
  gainPct: number;
}

// ── Price fetching infra ──────────────────────────────────────────────────────
// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Leaderboard() {
  const { player: me } = useLeagueStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [recentTrades, setRecentTrades] = useState<(Trade & { player_name: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (showBlockingState = false) => {
    try {
      if (showBlockingState && players.length === 0 && holdings.length === 0) setLoading(true);
      else setRefreshing(true);
      setError('');
      const [p, h, t] = await Promise.all([
        getAllPlayers(),
        getAllHoldings(),
        getRecentTrades(8),
      ]);
      setPlayers(p);
      setHoldings(h);
      setRecentTrades(t);
    } catch {
      setError('Could not load leaderboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [holdings.length, players.length]);

  useEffect(() => {
    void load(true);
    // Debounce: when someone makes a trade, Supabase fires events on trades +
    // holdings + players nearly simultaneously. Collapse them into a single reload.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { void load(false); }, 500);
    };
    const sub = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(sub);
    };
  }, [load]);

  const symbols = [...new Set(holdings.map(h => h.symbol))];
  const { quoteMap } = useStockQuotes(symbols);

  // Build and sort entries
  const entries: LeaderEntry[] = players.map(player => {
    const myHoldings = holdings.filter(h => h.player_id === player.id);
    const holdingsValue = myHoldings.reduce((sum, h) => {
      const price = quoteMap[h.symbol]?.c ?? h.avg_cost;
      return sum + h.shares * price;
    }, 0);
    const costBasis = myHoldings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
    const portfolioValue = holdingsValue;
    const gainPct = costBasis > 0 ? ((portfolioValue - costBasis) / costBasis) * 100 : 0;
    return { player, holdings: myHoldings, portfolioValue, gainPct };
  });
  entries.sort((a, b) => b.portfolioValue - a.portfolioValue);

  const myEntry = entries.find(e => e.player.id === me?.id);
  const myRank = myEntry ? entries.indexOf(myEntry) + 1 : null;
  const iMeInTop3 = myRank !== null && myRank <= 3;

  // Arrange podium: 2nd | 1st | 3rd
  const top3 = entries.slice(0, 3);
  const podiumOrder = top3.length >= 2
    ? [top3[1], top3[0], top3[2]].filter(Boolean)
    : top3;
  const podiumRanks: (1 | 2 | 3)[] = top3.length >= 2 ? [2, 1, 3] : [1];

  if (loading) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ height: 28, borderRadius: 8, background: 'var(--bg-surface)', marginBottom: 24, width: '40%' }} className="animate-pulse" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: 140, borderRadius: 12, background: 'var(--bg-surface)' }} className="animate-pulse" />)}
        </div>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 58, borderRadius: 0, background: 'var(--bg-surface)', marginBottom: 1 }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: myEntry && !iMeInTop3 ? 80 : 32 }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 16px 16px',
      }}>
        <div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: 'var(--text-primary)',
            letterSpacing: '-0.03em', margin: 0,
          }}>
            Portfolios
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            Public portfolios · {players.length} members{refreshing ? ' · Refreshing…' : ''}
          </p>
        </div>
        <button
          onClick={() => void load(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 10,
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={12} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          margin: '0 16px 12px', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, color: 'var(--color-down)' }}>{error}</span>
          <button onClick={() => void load(false)} style={{ fontSize: 12, color: 'var(--color-down)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Podium (top 3) ── */}
      {entries.length >= 1 && (
        <div style={{
          margin: '8px 16px 0',
          padding: '20px 12px 0',
          background: 'var(--bg-surface)',
          borderRadius: '16px 16px 0 0',
          border: '1px solid var(--border-subtle)',
          borderBottom: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
            {podiumOrder.map((entry, i) => entry && (
              <PodiumCard
                key={entry.player.id}
                entry={entry}
                rank={podiumRanks[i]}
                isMe={entry.player.id === me?.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Rest of leaderboard ── */}
      {entries.length > 3 && (
        <div style={{
          margin: '0 16px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderTop: 'none',
          borderRadius: '0 0 16px 16px',
          overflow: 'hidden',
        }}>
          {entries.slice(3).map((entry, i) => (
            <LeaderRow
              key={entry.player.id}
              entry={entry}
              rank={i + 4}
              isMe={entry.player.id === me?.id}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-tertiary)', fontSize: 14 }}>
          No players yet. Be the first to join!
        </div>
      )}

      {/* ── Recent Activity ── */}
      {recentTrades.length > 0 && (
        <div style={{ margin: '24px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Clock size={13} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
              Recent Activity
            </span>
          </div>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14, padding: '0 14px',
          }}>
            {recentTrades.map(t => (
              <ActivityItem key={t.id} trade={t} />
            ))}
          </div>
        </div>
      )}

      {/* ── Sticky "your rank" footer (only if you're outside top 3) ── */}
      {myEntry && !iMeInTop3 && myRank && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 16px',
          background: 'rgba(10,11,13,0.92)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center', gap: 12,
          zIndex: 50,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', minWidth: 24, textAlign: 'center' }}>
            #{myRank}
          </span>
          <Avatar name={myEntry.player.name} color={myEntry.player.avatar_color} size={32} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {myEntry.player.name} <span style={{ fontSize: 10, background: 'var(--accent-blue)', color: '#fff', padding: '1px 6px', borderRadius: 99, fontWeight: 600 }}>you</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {myRank > 1 ? `${myRank - 1} ahead` : 'Leading!'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              ${myEntry.portfolioValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: myEntry.gainPct >= 0 ? 'var(--color-up)' : 'var(--color-down)',
            }}>
              {myEntry.gainPct >= 0 ? '+' : ''}{myEntry.gainPct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
