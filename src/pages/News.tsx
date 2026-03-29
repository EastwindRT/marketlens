import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import { format, subDays } from 'date-fns';

function formStyle(formType: string): { bg: string; color: string; border: string } {
  if (formType.startsWith('SC 13D'))
    return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.3)' };
  return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.3)' };
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse" style={{
          padding: 14, borderRadius: 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <div style={{ width: 56, height: 22, borderRadius: 6, background: 'var(--bg-hover)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '55%', height: 13, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 6 }} />
            <div style={{ width: '35%', height: 10, borderRadius: 4, background: 'var(--bg-hover)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NewsPage() {
  const [days, setDays] = useState(7);

  const { data: filings, isLoading, error } = useQuery({
    queryKey: ['market-filings', days],
    queryFn: () => edgar.getRecentFilings(days),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate = format(new Date(), 'MMM d');

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{
              margin: '0 0 3px', fontSize: 20, fontWeight: 700,
              color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em',
            }}>
              Major Filings
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
              SC 13D · SC 13G · Amendments · {fromDate} – {toDate}
            </p>
          </div>

          {/* Day range pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                  fontSize: 12, fontWeight: 500, fontFamily: "'Inter', sans-serif",
                  background: days === d ? 'var(--bg-elevated)' : 'transparent',
                  color: days === d ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  border: `1px solid ${days === d ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                  transition: 'all 120ms',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading && <Skeleton />}

        {error && (
          <p style={{ color: 'var(--color-down)', fontSize: 13, padding: '20px 0' }}>
            Could not load filings — EDGAR may be temporarily unavailable.
          </p>
        )}

        {!isLoading && !error && filings?.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 10 }}>
              No 13D/13G filings in the last {days} days.
            </p>
            <a
              href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13D&dateb=&owner=include&count=40"
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              Browse on EDGAR <ExternalLink size={12} />
            </a>
          </div>
        )}

        {!isLoading && !error && filings && filings.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filings.map((f: MarketFiling, i: number) => {
                const fc = formStyle(f.formType);
                return (
                  <a
                    key={f.accessionNo || i}
                    href={f.edgarUrl}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                      borderRadius: 12, textDecoration: 'none',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                      flexShrink: 0, whiteSpace: 'nowrap',
                      background: fc.bg, color: fc.color, border: `1px solid ${fc.border}`,
                      fontFamily: "'Roboto Mono', monospace",
                    }}>
                      {f.formType}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {f.subjectCompany && (
                        <p style={{
                          margin: '0 0 2px', fontSize: 13, fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {f.subjectCompany}
                        </p>
                      )}
                      <p style={{
                        margin: 0, fontSize: 12,
                        color: f.subjectCompany ? 'var(--text-secondary)' : 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {f.subjectCompany ? `Filed by ${f.filerName}` : f.filerName}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                        {f.filedDate}
                        {f.periodOfReport && f.periodOfReport !== f.filedDate ? ` · Period: ${f.periodOfReport}` : ''}
                      </p>
                    </div>

                    <ExternalLink size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                  </a>
                );
              })}
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14 }}>
              <span style={{ color: '#F7931A', fontWeight: 600 }}>13D</span> = 5%+ stake, activist intent ·{' '}
              <span style={{ color: 'var(--accent-blue-light)', fontWeight: 600 }}>13G</span> = 5%+ stake, passive · Source: SEC EDGAR
            </p>
          </>
        )}
      </div>
    </div>
  );
}
