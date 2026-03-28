import type { InsiderTransaction, OHLCVBar } from '../../api/types';
import { getInsiderType, SEC_CODE_LABELS, SEDI_CODE_LABELS } from '../../hooks/useInsiderData';
import { formatPrice, formatDate, formatLargeNumber } from '../../utils/formatters';
import { calcPostTradePerf, fmtPerf, perfColor } from '../../utils/correlation';

// Grid: Date | Name | Role | Type | Code | Shares | Price | Value | 30d | 90d
export const INSIDER_GRID = '90px 1fr 96px 56px 44px 84px 72px 84px 58px 58px';
// Mobile grid: Date | Name | Type | Value (4 columns)
export const INSIDER_GRID_MOBILE = '76px 1fr 52px 72px';

function getCodeLabel(rawCode?: string, isCA?: boolean): string {
  if (!rawCode) return '';
  const map = isCA ? SEDI_CODE_LABELS : SEC_CODE_LABELS;
  return map[rawCode] || rawCode;
}

interface InsiderRowProps {
  transaction: InsiderTransaction;
  candles?: OHLCVBar[];
  currency?: 'USD' | 'CAD';
  isCanadian?: boolean;
  onClick?: () => void;
}

export function InsiderRow({ transaction, candles = [], currency = 'USD', isCanadian = false, onClick }: InsiderRowProps) {
  const type = getInsiderType(transaction.transactionCode, transaction.change);
  const isBuy = type === 'BUY';
  const shares = Math.abs(transaction.share ?? transaction.change);
  const value = shares * transaction.transactionPrice;
  const codeLabel = getCodeLabel(transaction.rawCode, isCanadian);

  const perf = calcPostTradePerf(transaction.transactionDate, candles);
  const p30 = fmtPerf(perf.pct30d);
  const p90 = fmtPerf(perf.pct90d);
  const c30 = perfColor(perf.pct30d, type);
  const c90 = perfColor(perf.pct90d, type);

  const sharedCellStyle = {
    borderColor: 'var(--border-subtle)',
    cursor: onClick ? 'pointer' : 'default',
  };

  return (
    <>
      {/* ── Mobile row (< md): 4 columns — Date | Name | Type | Value ── */}
      <div
        className="md:hidden grid gap-2 px-4 py-3 text-sm border-b transition-colors"
        style={{
          gridTemplateColumns: INSIDER_GRID_MOBILE,
          ...sharedCellStyle,
        }}
        onClick={onClick}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Date */}
        <span
          className="self-center text-xs"
          style={{ color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}
        >
          {formatDate(transaction.transactionDate)}
        </span>

        {/* Name */}
        <span className="truncate self-center text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {transaction.name}
        </span>

        {/* Type badge */}
        <div className="self-center">
          <span
            className="px-1.5 py-0.5 text-xs font-bold rounded"
            style={{
              background: isBuy ? 'rgba(5,177,105,0.1)' : 'rgba(246,70,93,0.1)',
              color: isBuy ? 'var(--color-up)' : 'var(--color-down)',
              letterSpacing: '0.04em',
              fontSize: 10,
            }}
          >
            {type}
          </span>
        </div>

        {/* Value */}
        <span
          className="self-center text-right text-xs font-semibold"
          style={{
            color: isBuy ? 'var(--color-up)' : 'var(--color-down)',
            fontFamily: "'Roboto Mono', monospace",
          }}
        >
          {formatLargeNumber(value)}
        </span>
      </div>

      {/* ── Desktop row (≥ md): 10 columns — full layout ── */}
      <div
        className="hidden md:grid gap-2 px-6 py-3 text-sm border-b transition-colors"
        style={{
          gridTemplateColumns: INSIDER_GRID,
          ...sharedCellStyle,
        }}
        onClick={onClick}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Date */}
        <span className="self-center text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
          {formatDate(transaction.transactionDate)}
        </span>

        {/* Name */}
        <span className="truncate self-center text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {transaction.name}
        </span>

        {/* Role */}
        <span className="truncate self-center text-xs" style={{ color: 'var(--text-tertiary)' }} title={transaction.title}>
          {transaction.title || '—'}
        </span>

        {/* Type badge */}
        <div className="self-center">
          <span
            className="px-2 py-0.5 text-xs font-bold rounded"
            style={{
              background: isBuy ? 'rgba(5,177,105,0.1)' : 'rgba(246,70,93,0.1)',
              color: isBuy ? 'var(--color-up)' : 'var(--color-down)',
              letterSpacing: '0.05em',
            }}
          >
            {type}
          </span>
        </div>

        {/* Code */}
        <div className="self-center" title={codeLabel}>
          <span
            className="px-1.5 py-0.5 text-xs font-mono rounded"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-tertiary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '10px',
              letterSpacing: '0.04em',
            }}
          >
            {transaction.rawCode ?? transaction.transactionCode}
          </span>
        </div>

        {/* Shares */}
        <span className="self-center text-right text-xs" style={{ color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
          {shares.toLocaleString()}
        </span>

        {/* Price */}
        <span className="self-center text-right text-xs" style={{ color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
          {formatPrice(transaction.transactionPrice, currency)}
        </span>

        {/* Value */}
        <span className="self-center text-right text-xs font-semibold" style={{ color: isBuy ? 'var(--color-up)' : 'var(--color-down)', fontFamily: "'Roboto Mono', monospace" }}>
          {formatLargeNumber(value)}
        </span>

        {/* 30d performance */}
        <span className="self-center text-right text-xs font-semibold" style={{ color: c30, fontFamily: "'Roboto Mono', monospace" }}>
          {p30}
        </span>

        {/* 90d performance */}
        <span className="self-center text-right text-xs font-semibold" style={{ color: c90, fontFamily: "'Roboto Mono', monospace" }}>
          {p90}
        </span>
      </div>
    </>
  );
}
