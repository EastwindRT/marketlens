import { Link } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import type { ConvergenceSignal } from '../../api/news';

export function ConvergenceCard({ signals, note }: { signals: ConvergenceSignal[]; note?: string | null }) {
  return (
    <section
      data-agent-section="alerts-convergence"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 18,
      }}
    >
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <GitMerge size={16} style={{ color: 'var(--accent-blue-light)' }} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
            Convergence
          </h2>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Portfolio + filings
        </span>
      </div>

      {signals.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {note || 'No current collisions between your portfolio/watchlist and fresh filings.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {signals.map((signal) => (
            <div
              data-agent-section="alerts-convergence-signal"
              data-symbol={signal.symbol}
              key={signal.symbol}
              style={{
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div style={{ minWidth: 0 }}>
                  <Link
                    to={`/stock/${signal.symbol}`}
                    style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}
                  >
                    {signal.symbol}
                  </Link>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {signal.reasons.map((reason) => (
                      <span
                        key={reason}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 999,
                          background: 'rgba(45,107,255,0.10)',
                          border: '1px solid rgba(45,107,255,0.20)',
                          color: 'var(--accent-blue-light)',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    color: signal.score >= 80 ? '#F6465D' : '#F7931A',
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  {signal.score}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
