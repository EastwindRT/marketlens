import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Briefcase } from 'lucide-react';
import { getHoldings, getAllPlayers, supabase } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';
import { useStockQuote } from '../hooks/useStockData';
import type { Holding, Player } from '../api/supabase';
import { formatPrice } from '../utils/formatters';

const STARTING_CASH = 1000;

function HoldingRow({ holding }: { holding: Holding }) {
  const { data: quote } = useStockQuote(holding.symbol);
  const currentPrice = quote?.c ?? holding.avg_cost;
  const currentValue = currentPrice * holding.shares;
  const costBasis = holding.avg_cost * holding.shares;
  const gainLoss = currentValue - costBasis;
  const gainPct = ((currentValue - costBasis) / costBasis) * 100;
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
}

function SymbolPrice({ symbol, onPrice }: { symbol: string; onPrice: (p: number) => void }) {
  const { data } = useStockQuote(symbol);
  useEffect(() => {
    if (data?.c) onPrice(data.c);
  }, [data?.c]);
  return null;
}

export default function PlayerPortfolio() {
  const { playerId } = useParams<{ playerId: string }>();
  const navigate = useNavigate();
  const { player: me } = useLeagueStore();

  const [player, setPlayer] = useState<Player | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // If viewing own portfolio, redirect to /portfolio
  useEffect(() => {
    if (me && playerId === me.id) {
      navigate('/portfolio', { replace: true });
    }
  }, [me, playerId]);

  useEffect(() => {
    if (!playerId) return;
    async function load() {
      try {
        const [allPlayers, h] = await Promise.all([
          getAllPlayers(),
          getHoldings(playerId!),
        ]);
        const found = allPlayers.find(p => p.id === playerId);
        if (!found) { setError('Player not found.'); return; }
        setPlayer(found);
        setHoldings(h);
      } catch {
        setError('Could not load portfolio.');
      } finally {
        setLoading(false);
      }
    }
    load();

    // Real-time
    const sub = supabase
      .channel(`player-portfolio-${playerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings',
        filter: `player_id=eq.${playerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [playerId]);

  const symbols = [...new Set(holdings.map(h => h.symbol))];
  const holdingsValue = holdings.reduce((sum, h) => {
    return sum + h.shares * (priceMap[h.symbol] ?? h.avg_cost);
  }, 0);
  const total = (player?.cash ?? 0) + holdingsValue;
  const gain = total - STARTING_CASH;
  const gainPct = (gain / STARTING_CASH) * 100;
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
      {/* Price fetchers */}
      {symbols.map(sym => (
        <SymbolPrice key={sym} symbol={sym} onPrice={p => setPriceMap(prev => ({ ...prev, [sym]: p }))} />
      ))}

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
          {player.name[0].toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {player.name}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>Portfolio</p>
        </div>
      </div>

      {/* Summary card */}
      <div style={{ margin: '0 16px 20px' }}>
        <div style={{
          padding: '18px 20px', borderRadius: 14,
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Total Portfolio
          </div>
          <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '4px 0 2px' }}>
            ${total.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}>
            {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {isUp ? '+' : ''}{formatPrice(Math.abs(gain))} ({isUp ? '+' : ''}{gainPct.toFixed(2)}%)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Cash</div>
              <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                {formatPrice(player.cash)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Invested</div>
              <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                {formatPrice(holdingsValue)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Holdings */}
      <div style={{ margin: '0 16px' }}>
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
            holdings.map(h => <HoldingRow key={h.id} holding={h} />)
          )}
        </div>
      </div>
    </div>
  );
}
