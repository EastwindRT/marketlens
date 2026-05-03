import { CalendarRange, ExternalLink } from 'lucide-react';
import type { MacroCalendarEvent } from '../../api/news';

function formatEventDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function daysLabel(daysUntil: number | null) {
  if (daysUntil == null) return 'Upcoming';
  if (daysUntil <= 0) return 'Today';
  if (daysUntil === 1) return '1 day';
  return `${daysUntil} days`;
}

function importanceTone(level: MacroCalendarEvent['importance']) {
  if (level === 'high') {
    return {
      border: 'rgba(45, 107, 255, 0.24)',
      chip: 'rgba(45, 107, 255, 0.12)',
      color: 'var(--accent-blue-light)',
    };
  }
  if (level === 'medium') {
    return {
      border: 'rgba(247, 147, 26, 0.24)',
      chip: 'rgba(247, 147, 26, 0.12)',
      color: '#F7931A',
    };
  }
  return {
    border: 'var(--border-subtle)',
    chip: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
  };
}

export function MacroCalendarCard({
  events,
  note,
}: {
  events: MacroCalendarEvent[];
  note?: string | null;
}) {
  return (
    <section
      data-agent-section="macro-calendar"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 18,
      }}
    >
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 14 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <CalendarRange size={18} style={{ color: 'var(--accent-blue-light)' }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Upcoming Macro Calendar
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', maxWidth: 760 }}>
            The next high-signal economic and policy events that can move rates, equities, sectors, and the dollar.
          </p>
        </div>
      </div>

      {note && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>{note}</p>
        </div>
      )}

      {events.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-primary)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            No upcoming macro events are loaded right now.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {events.map((event) => {
            const tone = importanceTone(event.importance);
            return (
              <article
                data-agent-section="macro-calendar-event"
                key={event.id}
                style={{
                  background: 'var(--bg-primary)',
                  border: `1px solid ${tone.border}`,
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div className="flex items-start justify-between gap-3" style={{ marginBottom: 10 }}>
                  <div>
                    <div className="flex items-center gap-2" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          borderRadius: 999,
                          padding: '4px 10px',
                          background: tone.chip,
                          color: tone.color,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {event.importance}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                        {daysLabel(event.daysUntil)}
                      </span>
                    </div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {event.title}
                    </h3>
                  </div>
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {event.source}
                    <ExternalLink size={12} />
                  </a>
                </div>

                <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {formatEventDate(event.scheduledAt)}
                </p>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                  {event.whyImportant}
                </p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {event.implications.map((implication) => (
                    <p key={implication} style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {implication}
                    </p>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
