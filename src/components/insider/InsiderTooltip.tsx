import type { InsiderTransaction } from '../../api/types';
import { getInsiderType } from '../../hooks/useInsiderData';
import { formatPrice, formatDate, formatLargeNumber } from '../../utils/formatters';

interface InsiderTooltipProps {
  transaction: InsiderTransaction;
}

export function InsiderTooltip({ transaction }: InsiderTooltipProps) {
  const type = getInsiderType(transaction.transactionCode);
  const isUp = type === 'BUY';
  const value = Math.abs(transaction.change * transaction.transactionPrice);

  return (
    <div
      className="rounded-xl p-4 text-sm"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        minWidth: 220,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)', fontSize: 18 }}>
          {isUp ? '▲' : '▼'}
        </span>
        <div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{transaction.name}</div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Insider</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Type</div>
          <div className="font-medium" style={{ color: isUp ? 'var(--color-up)' : 'var(--color-down)' }}>{type}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Date</div>
          <div style={{ color: 'var(--text-secondary)' }}>{formatDate(transaction.transactionDate)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Shares</div>
          <div style={{ color: 'var(--text-secondary)' }}>{Math.abs(transaction.change).toLocaleString()}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Price</div>
          <div style={{ color: 'var(--text-secondary)' }}>{formatPrice(transaction.transactionPrice)}</div>
        </div>
        <div className="col-span-2">
          <div style={{ color: 'var(--text-tertiary)' }}>Total Value</div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatLargeNumber(value)}</div>
        </div>
      </div>
    </div>
  );
}
