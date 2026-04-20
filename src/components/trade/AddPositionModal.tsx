import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useStockQuote } from '../../hooks/useStockData';
import { isTSXTicker } from '../../utils/marketHours';
import TradeModal from './TradeModal';

interface AddPositionModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Two-step flow: (1) pick symbol, (2) open TradeModal with that symbol.
 * On portfolio page we want users to type any ticker (AAPL, SHOP.TO, etc.)
 * without first visiting the stock detail page.
 */
export default function AddPositionModal({ onClose, onSuccess }: AddPositionModalProps) {
  const [symbolInput, setSymbolInput] = useState('');
  const [confirmedSymbol, setConfirmedSymbol] = useState<string | null>(null);

  const normalizedSymbol = symbolInput.trim().toUpperCase();
  const isCanadian = normalizedSymbol ? isTSXTicker(normalizedSymbol) : false;

  // Only fetch quote after the user confirms a symbol
  const { data: quote, isLoading: quoteLoading, isError: quoteError } = useStockQuote(
    confirmedSymbol ?? ''
  );

  // Step 2: symbol confirmed & quote loaded → hand off to TradeModal
  if (confirmedSymbol) {
    if (quoteLoading) {
      return (
        <Overlay onClose={onClose}>
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
              Looking up {confirmedSymbol}…
            </p>
          </div>
        </Overlay>
      );
    }
    if (quoteError || !quote?.c) {
      return (
        <Overlay onClose={onClose}>
          <div style={{ padding: '24px 16px' }}>
            <p style={{ color: 'var(--color-down)', fontSize: 14, margin: '0 0 12px' }}>
              Couldn't find a quote for <strong>{confirmedSymbol}</strong>.
            </p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 12, margin: '0 0 16px' }}>
              Double-check the ticker. For Canadian stocks append <code>.TO</code> (e.g. SHOP.TO).
            </p>
            <button
              onClick={() => setConfirmedSymbol(null)}
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
      <TradeModal
        symbol={confirmedSymbol}
        exchange={isTSXTicker(confirmedSymbol) ? 'TSX' : 'NASDAQ'}
        companyName={(quote as { _name?: string })._name ?? confirmedSymbol}
        currentPrice={quote.c}
        currency={isTSXTicker(confirmedSymbol) ? 'CAD' : 'USD'}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  // Step 1: symbol picker
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Add a position
        </h2>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-tertiary)',
        }}>
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
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && normalizedSymbol) {
              setConfirmedSymbol(normalizedSymbol);
            }
          }}
          placeholder="AAPL, SHOP.TO, MSFT…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 15, fontFamily: 'Roboto Mono, monospace',
            color: 'var(--text-primary)', textTransform: 'uppercase',
          }}
        />
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '8px 0 20px' }}>
        US tickers plain. Canadian tickers append <code>.TO</code> (TSX).
        {normalizedSymbol && isCanadian && <span style={{ color: 'var(--accent-blue)' }}> · Canadian</span>}
      </p>

      <button
        onClick={() => normalizedSymbol && setConfirmedSymbol(normalizedSymbol)}
        disabled={!normalizedSymbol}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          background: normalizedSymbol ? 'var(--accent-blue)' : 'var(--bg-elevated)',
          color: normalizedSymbol ? '#fff' : 'var(--text-tertiary)',
          border: 'none', fontSize: 14, fontWeight: 600,
          cursor: normalizedSymbol ? 'pointer' : 'not-allowed',
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
