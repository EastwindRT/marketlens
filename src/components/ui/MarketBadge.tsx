import { clsx } from 'clsx';
import { getMarketStatus } from '../../utils/marketHours';

interface MarketBadgeProps {
  className?: string;
}

export function MarketBadge({ className }: MarketBadgeProps) {
  const { open, label } = getMarketStatus();
  return (
    <div className={clsx('flex items-center gap-1.5 text-xs font-medium', className)}>
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: open ? 'var(--color-up)' : 'var(--text-tertiary)' }}
      />
      <span style={{ color: open ? 'var(--color-up)' : 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}
