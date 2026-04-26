import { Link } from 'react-router-dom';
import type { InsiderFiling } from '../../api/news';
import { formatLargeNumber } from '../../utils/formatters';

interface InsiderFilingsTableProps {
  filings: InsiderFiling[];
  watchlistSymbols: string[];
}

function formatFiledDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function filingTone(type: 'BUY' | 'SELL') {
  if (type === 'BUY') {
    return {
      bg: 'rgba(14, 203, 129, 0.12)',
      border: 'rgba(14, 203, 129, 0.22)',
      color: 'var(--color-up)',
    };
  }
  return {
    bg: 'rgba(246, 70, 93, 0.12)',
    border: 'rgba(246, 70, 93, 0.22)',
    color: 'var(--color-down)',
  };
}

export function InsiderFilingsTable({ filings, watchlistSymbols }: InsiderFilingsTableProps) {
  if (filings.length === 0) {
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
          No material filings yet
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          When the alert pipeline flags watchlist-relevant insider activity, the filing rows will land here.
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
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '18px 18px 12px' }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Insider Filings
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          Recent material filings, with your watchlist names highlighted.
        </p>
      </div>

      <div className="hidden md:block" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {['Ticker', 'Insider', 'Type', 'Amount', 'Filed', 'Accession'].map((header) => (
                <th
                  key={header}
                  style={{
                    textAlign: 'left',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-tertiary)',
                    padding: '12px 18px',
                    fontWeight: 700,
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filings.map((filing) => {
              const highlighted = watchlistSymbols.includes(filing.ticker.toUpperCase());
              const tone = filingTone(filing.type);
              return (
                <tr key={filing.accessionNo} style={{ borderTop: '1px solid var(--border-subtle)', background: highlighted ? 'rgba(45, 107, 255, 0.06)' : 'transparent' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Link to={`/stock/${filing.ticker}`} style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                        {filing.ticker}
                      </Link>
                      {highlighted && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Watchlist
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-secondary)' }}>{filing.insiderName}</td>
                  <td style={{ padding: '14px 18px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '5px 8px',
                        borderRadius: 999,
                        background: tone.bg,
                        border: `1px solid ${tone.border}`,
                        color: tone.color,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {filing.type}
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formatLargeNumber(filing.amount)}
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-secondary)' }}>{formatFiledDate(filing.filedDate)}</td>
                  <td style={{ padding: '14px 18px', fontSize: 12, color: 'var(--text-tertiary)' }}>{filing.accessionNo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden" style={{ display: 'grid', gap: 10, padding: 14 }}>
        {filings.map((filing) => {
          const highlighted = watchlistSymbols.includes(filing.ticker.toUpperCase());
          const tone = filingTone(filing.type);
          return (
            <div
              key={filing.accessionNo}
              style={{
                border: `1px solid ${highlighted ? 'rgba(45, 107, 255, 0.24)' : 'var(--border-subtle)'}`,
                background: highlighted ? 'rgba(45, 107, 255, 0.06)' : 'var(--bg-elevated)',
                borderRadius: 14,
                padding: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Link to={`/stock/${filing.ticker}`} style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                    {filing.ticker}
                  </Link>
                  {highlighted && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Watchlist
                    </span>
                  )}
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '5px 8px',
                    borderRadius: 999,
                    background: tone.bg,
                    border: `1px solid ${tone.border}`,
                    color: tone.color,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {filing.type}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <Row label="Insider" value={filing.insiderName} />
                <Row label="Amount" value={formatLargeNumber(filing.amount)} strong />
                <Row label="Filed" value={formatFiledDate(filing.filedDate)} />
                <Row label="Accession" value={filing.accessionNo} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: 12, color: strong ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: strong ? 700 : 500, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
