import React, { useState } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { buildTradeNote, executeBuy, executeSell, isLikelyTransientTradeError } from '../../api/supabase';
import { useLeagueStore } from '../../store/leagueStore';
import { usePendingTradeStore } from '../../store/pendingTradeStore';
import { formatPrice } from '../../utils/formatters';

const SLOW_TRADE_NOTICE_MS = 10000;

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
  const { player } = useLeagueStore();
  const [mode, setMode] = useState<'BUY' | 'SELL'>('BUY');
  const [priceMode, setPriceMode] = useState<'MARKET' | 'CUSTOM'>('MARKET');
  const [sharesInput, setSharesInput] = useState('');
  const [customPriceInput, setCustomPriceInput] = useState('');
  const [customDateInput, setCustomDateInput] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [slowProcessing, setSlowProcessing] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [queuedForSync, setQueuedForSync] = useState(false);
  const enqueueTrade = usePendingTradeStore((state) => state.enqueueTrade);

  if (!player) return null;
  const currentPlayer = player;

  const shares = parseFloat(sharesInput) || 0;
  const customPrice = parseFloat(customPriceInput) || 0;
  const effectivePrice = priceMode === 'CUSTOM' ? customPrice : currentPrice;
  const total = shares * effectivePrice;

  async function handleTrade() {
    if (!shares || shares <= 0) {
      setError('Enter a valid number of shares');
      return;
    }
    if (priceMode === 'CUSTOM' && (!customPrice || customPrice <= 0)) {
      setError('Enter a valid custom price');
      return;
    }

    let tradedAt: string | undefined;
    if (priceMode === 'CUSTOM' && customDateInput) {
      const d = new Date(customDateInput);
      if (isNaN(d.getTime())) {
        setError('Invalid date');
        return;
      }
      tradedAt = d.toISOString();
    }

    setLoading(true);
    setSlowProcessing(false);
    setQueuedForSync(false);
    setError('');
    const slowNoticeTimer = window.setTimeout(() => {
      setSlowProcessing(true);
    }, SLOW_TRADE_NOTICE_MS);

    try {
      const clientTradeId = crypto.randomUUID();
      const tradeNote = buildTradeNote(note || undefined, clientTradeId);
      const result = mode === 'BUY'
        ? await executeBuy(currentPlayer, symbol, exchange, shares, effectivePrice, tradedAt, tradeNote)
        : await executeSell(currentPlayer, symbol, exchange, shares, effectivePrice, tradedAt, tradeNote);

      if (!result.success) {
        if (isLikelyTransientTradeError(result.error)) {
          enqueueTrade({
            id: clientTradeId,
            playerId: currentPlayer.id,
            symbol,
            exchange,
            tradeType: mode,
            shares,
            price: effectivePrice,
            total,
            tradedAt: tradedAt ?? null,
            note: tradeNote,
            createdAt: new Date().toISOString(),
          });
          setQueuedForSync(true);
          setDone(true);
          window.setTimeout(() => {
            onSuccess?.();
            onClose();
          }, 1200);
          return;
        }
        setError(result.error ?? 'Trade failed');
        return;
      }

      setDone(true);
      window.setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1200);
    } catch (err) {
      const message = String((err as Error)?.message || err);
      setError(`Connection error - ${message || 'check your network and try again'}`);
    } finally {
      window.clearTimeout(slowNoticeTimer);
      setLoading(false);
      setSlowProcessing(false);
    }
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
            {queuedForSync ? 'Queued' : mode === 'BUY' ? 'Bought' : 'Sold'} {shares} {symbol}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {queuedForSync ? 'Pending sync with Supabase' : `@ ${formatPrice(effectivePrice, currency)}`}
          </p>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{symbol}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              {exchange}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{companyName}</p>
        </div>
        <button onClick={onClose} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      <div className="flex rounded-xl p-1 mb-4" style={{ background: 'var(--bg-elevated)' }}>
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

      <div className="flex rounded-xl p-1 mb-4" style={{ background: 'var(--bg-elevated)' }}>
        {(['MARKET', 'CUSTOM'] as const).map((pm) => (
          <button
            key={pm}
            onClick={() => { setPriceMode(pm); setError(''); }}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: priceMode === pm ? 'var(--accent-blue)' : 'transparent',
              color: priceMode === pm ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {pm === 'MARKET' ? 'Market price' : 'Custom entry'}
          </button>
        ))}
      </div>

      {priceMode === 'MARKET' ? (
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Current Price</span>
          <span className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(currentPrice, currency)}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>CUSTOM PRICE</label>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={customPriceInput}
            onChange={(e) => { setCustomPriceInput(e.target.value); setError(''); }}
            placeholder={String(currentPrice)}
            className="px-4 rounded-xl outline-none text-base font-mono"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              height: 44,
              color: 'var(--text-primary)',
            }}
          />
          <label className="text-xs font-medium mt-1" style={{ color: 'var(--text-secondary)' }}>DATE (optional)</label>
          <input
            type="date"
            value={customDateInput}
            onChange={(e) => setCustomDateInput(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="px-4 rounded-xl outline-none text-sm font-mono"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              height: 44,
              color: 'var(--text-primary)',
            }}
          />
        </div>
      )}

      <div className="flex flex-col gap-2 mb-4">
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
            onKeyDown={(e) => e.key === 'Enter' && void handleTrade()}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-base font-mono"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>NOTE (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this trade?"
          maxLength={120}
          className="px-4 rounded-xl outline-none text-sm"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            height: 44,
            color: 'var(--text-primary)',
          }}
        />
      </div>

      {shares > 0 && effectivePrice > 0 && (
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

      {loading && slowProcessing && !error && (
        <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
          Still processing your trade. The request is alive, but Supabase is responding slowly right now.
        </p>
      )}

      <button
        onClick={() => void handleTrade()}
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
        {loading ? 'Processing...' : `${mode === 'BUY' ? 'Buy' : 'Sell'} ${symbol}`}
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
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
      >
        {children}
      </div>
    </div>
  );
}
