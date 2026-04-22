import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Briefcase, Eye } from 'lucide-react';
import { getHoldings, getPlayerById, getWatchlist, supabase } from '../api/supabase';
import { useStockQuotes } from '../hooks/useStockData';
import type { Holding, Player, WatchlistInput } from '../api/supabase';
import { formatPrice } from '../utils/formatters';

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
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        textDecoration: 'none',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
      }}>
        {holding.symbol.replace('.TO', '').slice(0, 4)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{holding.symbol}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {holding.shares} shares · avg {formatPrice(holding.avg_cost)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {formatPrice(currentValue)}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3,
          fontSize: 11, fontWeight: 600, marginTop: 2,
          color: isUp ? 'var(--color-up)' : 'var(--color-down)',
        }}>
          {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {isUp ? '+' : ''}{gainPct.toFixed(2)}%
        </div>
      </div>
    </Link>
  );
});

const WatchRow = React.memo(function WatchRow({ item, quote }: { item: WatchlistInput; quote?: { c?: number; d?: number; dp?: number } }) {
  const price = quote?.c;
  const change = quote?.d ?? 0;
  const changePct = quote?.dp ?? 0;
  const isUp = change >= 0;

  return (
    <Link
      to={`/stock/${item.symbol}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        textDecoration: 'none',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
      }}>
        {item.symbol.replace('.TO', '').slice(0, 4)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.symbol}</div>
        {item.name && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {price ? formatPrice(price) : '—'}
        </div>
        {price != null && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3,
            fontSize: 11, fontWeight: 600, marginTop: 2,
            color: isUp ? 'var(--color-up)' : 'var(--color-down)',
          }}>
            {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {isUp ? '+' : ''}{changePct.toFixed(2)}%
          </div>
        )}
      </div>
    </Link>
  );
});

export default function PlayerPortfolio() {
  const { playerId } = useParams<{ playerId: string }>();
  const navigate = useNavigate();

  const [player, setPlayer] = useState<Player | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!playerId) return;
    let isActive = true;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function load(showBlockingState: boolean) {
      const runId = ++requestId;
      try {
        if (showBlockingState && !hasLoadedRef.current) setLoading(true);
        else setRefreshing(true);
        if (showBlockingState || !hasLoadedRef.current) {
          setError('');
        }

        // Use allSettled so a failed watchlist/holdings fetch doesn't kill the whole page
        const [pRes, hRes, wRes] = await Promise.allSettled([
          getPlayerById(playerId!),
          getHoldings(playerId!),
          getWatchlist(playerId!),
        ]);
        if (!isActive || runId !== requestId) return;

        const p = pRes.status === 'fulfilled' ? pRes.value : null;
        if (!p) {
          const reason = pRes.status === 'rejected' ? String(pRes.reason) : 'Player not found.';
          setError(reason);
          return;
        }
        setPlayer(p);
        setError('');
        if (hRes.status === 'fulfilled') setHoldings(hRes.value);
        else setHoldings([]);

        if (wRes.status === 'fulfilled') {
          setWatchlist(wRes.value);
        } else {
          // Public portfolios should degrade to an empty watchlist instead of
          // throwing users into an error/reload path for a non-critical section.
          console.warn('[PlayerPortfolio] watchlist load failed:', wRes.reason);
          setWatchlist([]);
        }
        hasLoadedRef.current = true;
      } catch {
        if (!isActive || runId !== requestId) return;
        if (!hasLoadedRef.current) setError('Could not load portfolio.');
      } finally {
        if (!isActive || runId !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      }
    }
    void load(true);

    const sub = supabase
      .channel(`player-portfolio-${playerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings',
        filter: `player_id=eq.${playerId}` }, () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { void load(false); }, 250);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlists',
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
  }, [playerId]);

  const symbols = [...new Set([
    ...holdings.map((holding) => holding.symbol),
    ...watchlist.map((item) => item.symbol),
  ])];
  const { quoteMap } = useStockQuotes(symbols);
  const holdingsValue = holdings.reduce((sum, h) => {
    return sum + h.shares * (quoteMap[h.symbol]?.c ?? h.avg_cost);
  }, 0);
  const costBasis = holdings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
  const gain = holdingsValue - costBasis;
  const gainPct = costBasis > 0 ? (gain / costBasis) * 100 : 0;
  const isUp = gain >= 0;

  if (loading) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ height: 20, width: '30%', borderRadius: 6, background: 'var(--bg-surface)', marginBottom: 20 }} className="animate-pulse" />
        <div style={{ height: 100, borderRadius: 14, background: 'var(--bg-surface)', marginBottom: 16 }} className="animate-pulse" />
        {[1,2,3].map(i => <div key={i} style={{ height: 58, background: 'var(--bg-surface)', marginBottom: 1 }} className="animate-pulse" />)}
      </div>
    );
  }

  if (error || !player) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-down)', fontSize: 14 }}>{error || 'Player not found.'}</p>
        <button onClick={() => navigate(-1)} style={{ marginTop: 12, fontSize: 13, color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px 16px' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-secondary)',
          }}
        >
          <ArrowLeft size={16} />
        </button>
        <div
          style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: player.avatar_color, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 700,
          }}
        >
          {(player.display_name || player.name)[0].toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {player.display_name || player.name}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            Public portfolio{refreshing ? ' · Refreshing…' : ''}
          </p>
        </div>
      </div>

      {/* Summary card */}
      <div style={{ margin: '0 16px 20px' }}>
        <div style={{
          padding: '18px 20px', borderRadius: 14,
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Portfolio Value
          </div>
          <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '4px 0 2px' }}>
            ${holdingsValue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}>
            {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {isUp ? '+' : ''}{formatPrice(Math.abs(gain))} ({isUp ? '+' : ''}{gainPct.toFixed(2)}%)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Cost Basis</div>
              <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                {formatPrice(costBasis)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Positions</div>
              <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                {holdings.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Holdings */}
      <div style={{ margin: '0 16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Briefcase size={13} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Positions
          </span>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, overflow: 'hidden' }}>
          {holdings.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>No positions</p>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>{player.name} hasn't made any trades yet</p>
            </div>
          ) : (
            holdings.map(h => <HoldingRow key={h.id} holding={h} quote={quoteMap[h.symbol]} />)
          )}
        </div>
      </div>

      {/* Watchlist */}
      <div style={{ margin: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Eye size={13} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Watchlist
          </span>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, overflow: 'hidden' }}>
          {watchlist.length === 0 ? (
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>Watchlist is empty</p>
            </div>
          ) : (
            watchlist.map(w => <WatchRow key={w.symbol} item={w} quote={quoteMap[w.symbol]} />)
          )}
        </div>
      </div>
    </div>
  );
}
