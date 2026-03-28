import { formatPrice, formatChange } from '../../utils/formatters';
import type { Quote } from '../../api/types';
import { MarketBadge } from './MarketBadge';

interface PriceDisplayProps {
  symbol: string;
  companyName?: string;
  exchange?: string;
  quote?: Quote;
  livePrice?: number | null;
  currency?: string;
  className?: string;
}

export function PriceDisplay({ symbol, companyName, exchange, quote, livePrice, currency = 'USD' }: PriceDisplayProps) {
  const currentPrice = livePrice ?? quote?.c ?? 0;
  const change = quote?.d ?? 0;
  const changePct = quote?.dp ?? 0;
  const isUp = change >= 0;

  const cleanSymbol = symbol.replace('.TO', '');

  return (
    <div className="fade-in">
      {/* Row 1: Ticker · Exchange · Market status */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}
        >
          {cleanSymbol}
        </span>
        {exchange && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-md"
            style={{
              color: 'var(--text-tertiary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {exchange}
          </span>
        )}
        <MarketBadge />
      </div>

      {/* Row 2: Company name */}
      <div className="mb-3">
        <span className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
          {companyName || cleanSymbol}
        </span>
      </div>

      {/* Row 3: Price */}
      <div className="mb-1.5">
        <span
          className="mono"
          style={{
            color: 'var(--text-primary)',
            fontFamily: "'Roboto Mono', monospace",
            fontSize: 48,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {formatPrice(currentPrice, currency)}
        </span>
      </div>

      {/* Row 4: Change */}
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-semibold mono px-2.5 py-1 rounded-lg"
          style={{
            color: isUp ? 'var(--color-up)' : 'var(--color-down)',
            background: isUp ? 'rgba(5,177,105,0.12)' : 'rgba(246,70,93,0.12)',
            fontFamily: "'Roboto Mono', monospace",
          }}
        >
          {change >= 0 ? '+' : ''}{formatPrice(Math.abs(change), currency)} ({formatChange(changePct)})
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>today</span>
      </div>
    </div>
  );
}
