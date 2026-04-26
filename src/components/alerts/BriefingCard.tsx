import type { AgentAlert } from '../../api/news';

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface BriefingCardProps {
  alert: AgentAlert | null;
}

export function BriefingCard({ alert }: BriefingCardProps) {
  if (!alert) {
    return (
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 18,
          padding: 20,
        }}
      >
        <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          No briefing yet
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          Once the hourly agent run finds material news or filings tied to your watchlist, a short briefing will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Watchlist Briefing
          </p>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            Latest agent digest
          </h2>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {formatCreatedAt(alert.createdAt)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <Badge label={`${alert.bullets.length} bullets`} tone="neutral" />
        <Badge label={`${alert.sourceNewsIds.length} news items`} tone="blue" />
        <Badge label={`${alert.sourceFilings.length} insider filings`} tone="amber" />
        <Badge label={`${alert.watchlistSnapshot.length} watchlist names`} tone="neutral" />
      </div>

      <ul style={{ margin: '0 0 16px', paddingLeft: 18, display: 'grid', gap: 10 }}>
        {alert.bullets.map((bullet, index) => (
          <li key={`${alert.id}-${index}`} style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14 }}>
            {bullet}
          </li>
        ))}
      </ul>

      {alert.watchlistSnapshot.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>
            Watchlist snapshot
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alert.watchlistSnapshot.map((ticker) => (
              <span
                key={ticker}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'rgba(45, 107, 255, 0.12)',
                  border: '1px solid rgba(45, 107, 255, 0.24)',
                  color: 'var(--accent-blue-light)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {ticker}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'neutral' | 'blue' | 'amber' }) {
  const palette =
    tone === 'blue'
      ? { bg: 'rgba(45, 107, 255, 0.12)', border: 'rgba(45, 107, 255, 0.24)', color: 'var(--accent-blue-light)' }
      : tone === 'amber'
        ? { bg: 'rgba(247, 147, 26, 0.14)', border: 'rgba(247, 147, 26, 0.28)', color: '#F7931A' }
        : { bg: 'var(--bg-elevated)', border: 'var(--border-subtle)', color: 'var(--text-secondary)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}
