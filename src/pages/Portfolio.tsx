import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, LogOut, Briefcase } from 'lucide-react';
import { getHoldings, supabase } from '../api/supabase';
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
      className="flex items-center gap-3 px-4 py-4 rounded-2xl no-underline"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        marginBottom: 8,
        display: 'flex',
      }}
    >
      {/* Symbol */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      >
        {holding.symbol.replace('.TO', '').slice(0, 4)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          {holding.symbol}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {holding.shares} shares · avg {formatPrice(holding.avg_cost)}
        </div>
      </div>

      {/* Value + gain */}
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
}

export default function Portfolio() {
  const { player, logout } = useLeagueStore();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Fresh player data (cash may have changed via real-time)
  const [freshPlayer, setFreshPlayer] = useState(player);

  useEffect(() => {
    if (!player) { navigate('/'); return; }

    async function load() {
      try {
        setLoadError('');
        const h = await getHoldings(player!.id);
        setHoldings(h);
      } catch {
        setLoadError('Could not load holdings. Tap to retry.');
      } finally {
        setLoading(false);
      }
    }
    load();

    // Real-time updates when trades happen
    const sub = supabase
      .channel('portfolio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings',
        filter: `player_id=eq.${player.id}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players',
        filter: `id=eq.${player.id}` }, async () => {
          const { data } = await supabase.from('players').select('*').eq('id', player!.id).single();
          if (data) setFreshPlayer(data);
        })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [player]);

  if (!player) return null;

  const displayPlayer = freshPlayer ?? player;

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
      {/* Header */}
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
              {player.name}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>My Portfolio</p>
          </div>
        </div>
        <button
          onClick={() => { logout(); navigate('/'); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>

      {/* Portfolio summary card */}
      <PortfolioSummary player={displayPlayer} holdings={holdings} />

      {/* Holdings list */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} style={{ color: 'var(--text-tertiary)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Positions
          </span>
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
              Search for a stock and hit Buy to start
            </p>
            <Link
              to="/"
              className="inline-block mt-4 px-4 py-2 rounded-xl text-sm font-medium no-underline"
              style={{ background: 'var(--accent-blue)', color: '#fff' }}
            >
              Browse Stocks
            </Link>
          </div>
        ) : (
          holdings.map(h => <HoldingRow key={h.id} holding={h} />)
        )}
      </div>
    </div>
  );
}

function PortfolioSummary({ player, holdings }: { player: Player; holdings: Holding[] }) {
  // Use a price map: symbol → live price. Each SymbolPrice child updates one key.
  // Computing total from the map is safe — no accumulation across re-renders.
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const symbols = [...new Set(holdings.map(h => h.symbol))];

  const holdingsValue = holdings.reduce((sum, h) => {
    const price = priceMap[h.symbol] ?? h.avg_cost;
    return sum + h.shares * price;
  }, 0);

  return (
    <>
      {symbols.map(sym => (
        <SymbolPrice key={sym} symbol={sym} onPrice={(p) =>
          setPriceMap(prev => ({ ...prev, [sym]: p }))
        } />
      ))}
      <SummaryCard player={player} holdingsValue={holdingsValue} holdingsCount={holdings.length} />
    </>
  );
}

function SymbolPrice({ symbol, onPrice }: { symbol: string; onPrice: (p: number) => void }) {
  const { data } = useStockQuote(symbol);
  useEffect(() => {
    if (data?.c) onPrice(data.c);
  }, [data?.c]);
  return null;
}

function SummaryCard({ player, holdingsValue, holdingsCount }: {
  player: Player;
  holdingsValue: number;
  holdingsCount: number;
}) {
  const total = player.cash + holdingsValue;
  const gain = total - STARTING_CASH;
  const gainPct = (gain / STARTING_CASH) * 100;
  const isUp = gain >= 0;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
    >
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
        TOTAL PORTFOLIO
      </div>
      <div className="font-mono font-bold text-3xl" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        ${total.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Available Cash</div>
          <div className="font-mono font-semibold text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(player.cash)}
          </div>
        </div>
        <div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Invested</div>
          <div className="font-mono font-semibold text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(holdingsValue)}
          </div>
        </div>
      </div>
    </div>
  );
}
