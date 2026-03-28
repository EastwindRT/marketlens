import { clsx } from 'clsx';
import type { TimeRange } from '../../api/types';

const RANGES: TimeRange[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  className?: string;
}

export function TimeRangePicker({ value, onChange, className }: TimeRangePickerProps) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      {RANGES.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
          style={{
            background: value === range ? 'var(--accent-blue)' : 'transparent',
            color: value === range ? '#fff' : 'var(--text-secondary)',
            border: '1px solid',
            borderColor: value === range ? 'var(--accent-blue)' : 'transparent',
            cursor: 'pointer',
            transition: 'all 150ms ease-out',
          }}
          onMouseEnter={(e) => {
            if (value !== range) {
              (e.target as HTMLButtonElement).style.background = 'var(--bg-hover)';
              (e.target as HTMLButtonElement).style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (value !== range) {
              (e.target as HTMLButtonElement).style.background = 'transparent';
              (e.target as HTMLButtonElement).style.color = 'var(--text-secondary)';
            }
          }}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
