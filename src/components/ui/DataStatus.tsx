interface DataStatusProps {
  refreshing?: boolean;
  updatedAt?: number | string | null;
  source?: 'cached' | 'live';
}

function formatUpdatedAt(value?: number | string | null): string | null {
  if (value == null) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'Last updated just now';
  if (diffMin === 1) return 'Last updated 1 min ago';
  if (diffMin < 60) return `Last updated ${diffMin} min ago`;

  return `Last updated ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function DataStatus({ refreshing, updatedAt, source }: DataStatusProps) {
  const updatedLabel = formatUpdatedAt(updatedAt);
  const sourceLabel = source === 'cached' ? 'Cached snapshot' : null;
  const parts = [updatedLabel, sourceLabel].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {parts && (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {parts}
        </span>
      )}
      {refreshing && (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>
          Refreshing…
        </span>
      )}
    </div>
  );
}
