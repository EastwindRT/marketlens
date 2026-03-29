import React, { useState } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { executeBuy, executeSell, getHoldings } from '../../api/supabase';
import { useLeagueStore } from '../../store/leagueStore';
import { formatPrice } from '../../utils/formatters';

interface TradeModalProps {
  symbol: string;
  exchange: string;
  companyName: string;
  currentPrice: number;
  currency?: 'USD' | 'CAD';
  onClose: () => void;
  onSuccess?: () => void;
}

export default function TradeModal({
  symbol, exchange, companyName, currentPrice, currency = 'USD', onClose, onSuccess,
}: TradeModalProps) {
  const { player, updateCash } = useLeagueStore();
  const [mode, setMode] = useState<'BUY' | 'SELL'>('BUY');
  const [sharesInput, setSharesInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!player) return null;

  const shares = parseFloat(sharesInput) || 0;
  const total = shares * currentPrice;
  const maxBuyShares = Math.floor((player.cash / currentPrice) * 100) / 100;

  async function handleTrade() {
    if (!shares || shares <= 0) { setError('Enter a valid number of shares'); return; }
    setLoading(true);
    setError('');

    const result = mode === 'BUY'
      ? await executeBuy(player!, symbol, exchange, shares, currentPrice)
      : await executeSell(player!, symbol, exchange, shares, currentPrice);

    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Trade failed');
      return;
    }

    // Optimistically update local cash
    const newCash = mode === 'BUY' ? player!.cash - total : player!.cash + total;
    updateCash(newCash);
    setDone(true);
    setTimeout(() => { onSuccess?.(); onClose(); }, 1200);
  }

  if (done) {
    return (
      <Overlay onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: mode === 'BUY' ? 'rgba(5,177,105,0.15)' : 'rgba(246,70,93,0.15)' }}
          >
            {mode === 'BUY'
              ? <TrendingUp size={28} style={{ color: 'var(--color-up)' }} />
              : <TrendingDown size={28} style={{ color: 'var(--color-down)' }} />
            }
          </div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {mode === 'BUY' ? 'Bought' : 'Sold'} {shares} {symbol}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {formatPrice(total, currency)} {mode === 'BUY' ? 'spent' : 'received'}
          </p>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{symbol}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >{exchange}</span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{companyName}</p>
        </div>
        <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      {/* Buy / Sell toggle */}
      <div
        className="flex rounded-xl p-1 mb-5"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {(['BUY', 'SELL'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(''); }}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: mode === m ? (m === 'BUY' ? 'var(--color-up)' : 'var(--color-down)') : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Price info */}
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Current Price</span>
        <span className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          {formatPrice(currentPrice, currency)}
        </span>
      </div>

      <div className="flex justify-between items-center mb-5">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {mode === 'BUY' ? 'Available Cash' : 'Cash Balance'}
        </span>
        <span className="font-mono font-semibold text-sm" style={{ color: 'var(--color-up)' }}>
          {formatPrice(player.cash, 'USD')}
        </span>
      </div>

      {/* Shares input */}
      <div className="flex flex-col gap-2 mb-2">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>SHARES</label>
        <div
          className="flex items-center gap-3 px-4 rounded-xl"
          style={{
            background: 'var(--bg-elevated)',
            border: `1px solid ${error ? 'var(--color-down)' : 'var(--border-default)'}`,
            height: 52,
          }}
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={sharesInput}
            onChange={(e) => { setSharesInput(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleTrade()}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-base font-mono"
            style={{ color: 'var(--text-primary)' }}
          />
          {mode === 'BUY' && (
            <button
              onClick={() => setSharesInput(String(maxBuyShares))}
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{ background: 'var(--bg-hover)', color: 'var(--accent-blue-light)', border: 'none', cursor: 'pointer' }}
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {/* Total */}
      {shares > 0 && (
        <div
          className="flex justify-between items-center px-4 py-3 rounded-xl mb-4"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
        >
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total</span>
          <span className="font-mono font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(total, currency)}
          </span>
        </div>
      )}

      {error && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-down)' }}>{error}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleTrade}
        disabled={loading || !shares}
        className="w-full py-3.5 rounded-xl text-sm font-semibold"
        style={{
          background: mode === 'BUY' ? 'var(--color-up)' : 'var(--color-down)',
          color: '#fff',
          opacity: (loading || !shares) ? 0.5 : 1,
          cursor: (loading || !shares) ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      >
        {loading ? 'Processing…' : `${mode === 'BUY' ? 'Buy' : 'Sell'} ${symbol}`}
      </button>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
      >
        {children}
      </div>
    </div>
  );
}
