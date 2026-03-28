import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { InsiderTransaction, OHLCVBar } from '../../api/types';
import type { InsiderFilter } from '../../api/types';
import { InsiderRow, INSIDER_GRID, INSIDER_GRID_MOBILE } from './InsiderRow';
import { InsiderRowSkeleton } from '../ui/LoadingSkeleton';
import { getInsiderType, SEC_CODE_LABELS, SEDI_CODE_LABELS } from '../../hooks/useInsiderData';

interface InsiderPanelProps {
  transactions: InsiderTransaction[];
  candles?: OHLCVBar[];
  loading?: boolean;
  error?: Error | null;
  currency?: 'USD' | 'CAD';
  isCanadian?: boolean;
  onRowClick?: (transaction: InsiderTransaction) => void;
}

export function InsiderPanel({
  transactions,
  candles = [],
  loading,
  error,
  currency = 'USD',
  isCanadian = false,
  onRowClick,
}: InsiderPanelProps) {
  const [filter, setFilter]   = useState<InsiderFilter>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = transactions
    .filter(t => {
      if (filter === 'all') return true;
      const type = getInsiderType(t.transactionCode, t.change);
      return filter === 'buy' ? type === 'BUY' : type === 'SELL';
    })
    .sort((a, b) => {
      const diff = new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime();
      return sortDir === 'desc' ? -diff : diff;
    });

  const buys  = transactions.filter(t => getInsiderType(t.transactionCode, t.change) === 'BUY').length;
  const sells = transactions.filter(t => getInsiderType(t.transactionCode, t.change) === 'SELL').length;

  const hasCorrelation = candles.length > 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      {/* ── Panel Header ── */}
      <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between flex-wrap gap-4">

          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Insider Activity
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(5,177,105,0.12)', color: 'var(--color-up)' }}>
                {buys} Buys
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(246,70,93,0.12)', color: 'var(--color-down)' }}>
                {sells} Sells
              </span>
            </div>
            {hasCorrelation && (
              <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>
                30d / 90d = price after trade
              </span>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex items-center rounded-xl p-1"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            {(['all', 'buy', 'sell'] as InsiderFilter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1 text-xs font-semibold rounded-lg capitalize"
                style={{
                  background: filter === f ? 'var(--bg-hover)' : 'transparent',
                  color: filter === f
                    ? (f === 'buy' ? 'var(--color-up)' : f === 'sell' ? 'var(--color-down)' : 'var(--text-primary)')
                    : 'var(--text-tertiary)',
                  border: filter === f ? '1px solid var(--border-default)' : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                }}
              >
                {f === 'all' ? 'All' : f === 'buy' ? 'Buys' : 'Sells'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Column Headers — Mobile (4 cols) ── */}
      <div
        className="md:hidden grid gap-2 px-4 py-2.5 text-xs font-semibold"
        style={{
          gridTemplateColumns: INSIDER_GRID_MOBILE,
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 text-left"
          style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', font: 'inherit', minHeight: 44 }}
        >
          Date {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>
        <span className="self-center">Name</span>
        <span className="self-center">Type</span>
        <span className="self-center text-right">Value</span>
      </div>

      {/* ── Column Headers — Desktop (10 cols) ── */}
      <div
        className="hidden md:grid gap-2 px-6 py-2.5 text-xs font-semibold"
        style={{
          gridTemplateColumns: INSIDER_GRID,
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 text-left"
          style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', font: 'inherit' }}
        >
          Date {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>
        <span>Name</span>
        <span>Role</span>
        <span>Type</span>
        <span title="Transaction code from SEC Form 4 or SEDI">Code</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value</span>
        <span className="text-right" title="Price change 30 days after trade">30d</span>
        <span className="text-right" title="Price change 90 days after trade">90d</span>
      </div>

      {/* ── Rows ── */}
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {loading && Array.from({ length: 6 }).map((_, i) => <InsiderRowSkeleton key={i} />)}

        {error && (
          <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Failed to load insider data
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No insider transactions found</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Insider data may not be available for this ticker
            </p>
          </div>
        )}

        {!loading && !error && filtered.map((t, i) => (
          <InsiderRow
            key={i}
            transaction={t}
            candles={candles}
            currency={currency}
            isCanadian={isCanadian}
            onClick={() => onRowClick?.(t)}
          />
        ))}
      </div>

      {/* ── Code Legend ── */}
      {!loading && transactions.length > 0 && (
        <CodeLegend transactions={transactions} isCanadian={isCanadian} />
      )}
    </div>
  );
}

// ─── Code Legend ────────────────────────────────────────────────────────────

function CodeLegend({ transactions, isCanadian }: { transactions: InsiderTransaction[]; isCanadian: boolean }) {
  const [open, setOpen] = useState(false);

  // Collect only the codes actually present in this dataset
  const presentCodes = [...new Set(transactions.map(t => t.rawCode).filter(Boolean))] as string[];
  if (presentCodes.length === 0) return null;

  const codeMap = isCanadian ? SEDI_CODE_LABELS : SEC_CODE_LABELS;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-3 text-xs"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        <span>Transaction Code Reference — {isCanadian ? 'SEDI (Canada)' : 'SEC Form 4 (US)'}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div
          className="px-6 pb-5"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <div className="flex flex-wrap gap-x-8 gap-y-2 pt-2">
            {presentCodes.map(code => (
              <div key={code} className="flex items-center gap-2 min-w-[180px]">
                <span
                  className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)',
                    fontSize: '10px',
                  }}
                >
                  {code}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {codeMap[code] || 'Other transaction'}
                </span>
              </div>
            ))}
          </div>

          {/* Show all possible codes for reference */}
          {Object.keys(codeMap).filter(c => !presentCodes.includes(c)).length > 0 && (
            <>
              <p className="text-xs mt-4 mb-2 font-semibold" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                All {isCanadian ? 'SEDI' : 'SEC'} Codes
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-1.5">
                {Object.entries(codeMap).map(([code, label]) => (
                  <div key={code} className="flex items-center gap-2 min-w-[180px]">
                    <span
                      className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: presentCodes.includes(code) ? 'rgba(22,82,240,0.15)' : 'var(--bg-surface)',
                        color: presentCodes.includes(code) ? 'var(--accent-blue-light)' : 'var(--text-tertiary)',
                        border: `1px solid ${presentCodes.includes(code) ? 'rgba(45,107,255,0.3)' : 'var(--border-subtle)'}`,
                        fontSize: '10px',
                      }}
                    >
                      {code}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
