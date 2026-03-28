import { clsx } from 'clsx';

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  className?: string;
}

export function StatCard({ label, value, subValue, className }: StatCardProps) {
  return (
    <div
      className={clsx('rounded-xl p-4', className)}
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="text-lg font-semibold mono" style={{ color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {subValue}
        </div>
      )}
    </div>
  );
}
