import { useEffect, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { useStockQuote } from '../../hooks/useStockData';
import { useWatchlistStore } from '../../store/watchlistStore';
import { isTSXTicker } from '../../utils/marketHours';
import { formatPrice } from '../../utils/formatters';

interface AddWatchlistModalProps {
  onClose: () => void;
}

export default function AddWatchlistModal({ onClose }: AddWatchlistModalProps) {
  const addItem = useWatchlistStore((state) => state.addItem);
  const hasItem = useWatchlistStore((state) => state.hasItem);
  const [symbolInput, setSymbolInput] = useState('');
  const [confirmedSymbol, setConfirmedSymbol] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const normalizedSymbol = symbolInput.trim().toUpperCase();
  const duplicate = !!normalizedSymbol && hasItem(normalizedSymbol);
  const { data: quote, isLoading: quoteLoading, isError: quoteError } = useStockQuote(confirmedSymbol ?? '');

  useEffect(() => {
    if (!confirmedSymbol || !quoteLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [confirmedSymbol, quoteLoading]);

  async function handleAdd() {
    if (!confirmedSymbol || !quote?.c) return;
    setSaving(true);
    setError('');
    try {
      await addItem({
        symbol: confirmedSymbol,
        name: (quote as { _name?: string })._name ?? confirmedSymbol,
        exchange: isTSXTicker(confirmedSymbol) ? 'TSX' : 'NASDAQ',
      });
      onClose();
    } catch {
      setError('Could not add this symbol to your watchlist right now.');
      setSaving(false);
    }
  }

  if (confirmedSymbol) {
    if (quoteLoading && !timedOut) {
      return (
        <Overlay onClose={onClose}>
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
              Looking up {confirmedSymbol}...
            </p>
          </div>
        </Overlay>
      );
    }

    if (timedOut || quoteError || !quote?.c) {
      return (
        <Overlay onClose={onClose}>
          <div style={{ padding: '24px 16px' }}>
            <p style={{ color: 'var(--color-down)', fontSize: 14, margin: '0 0 12px' }}>
              Couldn&apos;t find a quote for <strong>{confirmedSymbol}</strong>.
            </p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 12, margin: '0 0 16px' }}>
              Double-check the ticker. For Canadian stocks append <code>.TO</code>.
            </p>
            <button
              onClick={() => {
                setConfirmedSymbol(null);
                setTimedOut(false);
              }}
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer',
              }}
            >
              Try another ticker
            </button>
          </div>
        </Overlay>
      );
    }

    return (
      <Overlay onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Add to watchlist
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0' }}>
              {confirmedSymbol} · {formatPrice(quote.c, isTSXTicker(confirmedSymbol) ? 'CAD' : 'USD')}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            padding: '14px 16px', borderRadius: 12, marginBottom: 16,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{confirmedSymbol}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {(quote as { _name?: string })._name ?? 'Tracked in your personal watchlist'}
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--color-down)', fontSize: 12, margin: '0 0 12px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setConfirmedSymbol(null)}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 12,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', fontSize: 14, cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            onClick={() => void handleAdd()}
            disabled={saving}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 12,
              background: 'var(--accent-blue)', color: '#fff',
              border: 'none', fontSize: 14, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Adding...' : 'Add symbol'}
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Add to watchlist
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
          <X size={20} />
        </button>
      </div>

      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
        TICKER SYMBOL
      </label>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px',
        borderRadius: 12, height: 52,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      }}>
        <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
        <input
          autoFocus
          type="text"
          value={symbolInput}
          onChange={(e) => {
            setSymbolInput(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && normalizedSymbol && !duplicate) {
              setConfirmedSymbol(normalizedSymbol);
            }
          }}
          placeholder="AAPL, SHOP.TO, MSFT..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 15, fontFamily: 'Roboto Mono, monospace',
            color: 'var(--text-primary)', textTransform: 'uppercase',
          }}
        />
      </div>
      <p style={{ fontSize: 11, color: duplicate ? 'var(--color-down)' : 'var(--text-tertiary)', margin: '8px 0 20px' }}>
        {duplicate
          ? `${normalizedSymbol} is already in your watchlist.`
          : 'Use plain US tickers or append .TO for Canadian stocks.'}
      </p>

      <button
        onClick={() => normalizedSymbol && !duplicate && setConfirmedSymbol(normalizedSymbol)}
        disabled={!normalizedSymbol || duplicate}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          background: normalizedSymbol && !duplicate ? 'var(--accent-blue)' : 'var(--bg-elevated)',
          color: normalizedSymbol && !duplicate ? '#fff' : 'var(--text-tertiary)',
          border: 'none', fontSize: 14, fontWeight: 600,
          cursor: normalizedSymbol && !duplicate ? 'pointer' : 'not-allowed',
        }}
      >
        Continue
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
