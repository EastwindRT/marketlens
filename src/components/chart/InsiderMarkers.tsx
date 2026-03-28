import { useState } from 'react';
import type { InsiderTransaction } from '../../api/types';
import { getInsiderType } from '../../hooks/useInsiderData';
import { formatPrice, formatDate, formatInsiderValue } from '../../utils/formatters';

interface InsiderTooltipProps {
  transaction: InsiderTransaction;
  x: number;
  y: number;
}

export function InsiderTooltipPopup({ transaction, x, y }: InsiderTooltipProps) {
  const type = getInsiderType(transaction.transactionCode);
  const isUp = type === 'BUY';

  return (
    <div
      className="absolute z-50 rounded-xl p-3 text-sm pointer-events-none"
      style={{
        left: x + 12,
        top: y - 80,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        minWidth: 200,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: isUp ? 'var(--insider-buy)' : 'var(--insider-sell)', fontSize: 16 }}>
          {isUp ? '▲' : '▼'}
        </span>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{type}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>{transaction.name}</div>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {Math.abs(transaction.change).toLocaleString()} shares @ {formatPrice(transaction.transactionPrice)}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Value: {formatInsiderValue(transaction.change, transaction.transactionPrice)}
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {formatDate(transaction.transactionDate)}
      </div>
    </div>
  );
}
