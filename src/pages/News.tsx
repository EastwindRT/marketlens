import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Newspaper, FileText } from 'lucide-react';
import { finnhub } from '../api/finnhub';
import { edgar } from '../api/edgar';
import type { MarketFiling } from '../api/edgar';
import type { NewsItem } from '../api/types';
import { format, fromUnixTime, subDays } from 'date-fns';

type Tab = 'news' | 'filings';

// ── helpers ──────────────────────────────────────────────────────────────────

function formStyle(formType: string): { bg: string; color: string; border: string } {
  if (formType.startsWith('SC 13D'))
    return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.3)' };
  return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.3)' };
}

// ── skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse"
          style={{
            padding: 14, borderRadius: 12,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}
        >
          <div style={{ width: 56, height: 22, borderRadius: 6, background: 'var(--bg-hover)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '60%', height: 13, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 6 }} />
            <div style={{ width: '35%', height: 10, borderRadius: 4, background: 'var(--bg-hover)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── News tab ─────────────────────────────────────────────────────────────────

function NewsTab() {
  const general = useQuery({
    queryKey: ['market-news', 'general'],
    queryFn: () => finnhub.getMarketNews('general'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const merger = useQuery({
    queryKey: ['market-news', 'merger'],
    queryFn: () => finnhub.getMarketNews('merger'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const loading = general.isLoading && merger.isLoading;

  // Merge + deduplicate + sort newest first, cap at 40
  const combined: NewsItem[] = (() => {
    const all = [...(general.data ?? []), ...(merger.data ?? [])];
    const seen = new Set<string>();
    return all
      .filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; })
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 40);
  })();

  if (loading) return <Skeleton rows={6} />;
  if (!combined.length) {
    return (
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '24px 0' }}>
        No market news available right now.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {combined.map((item, i) => (
        <a
          key={item.id ?? i}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', gap: 12, padding: 14, borderRadius: 12,
            textDecoration: 'none',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            transition: 'border-color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {item.source}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, marginLeft: 8 }}>
                {format(fromUnixTime(item.datetime), 'MMM d, h:mma')}
              </span>
            </div>
            <p style={{
              margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
              lineHeight: 1.45,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {item.headline}
            </p>
          </div>
          {item.image && (
            <img
              src={item.image} alt=""
              style={{
                width: 56, height: 56, borderRadius: 8, objectFit: 'cover',
                flexShrink: 0, background: 'var(--bg-surface)',
              }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </a>
      ))}
    </div>
  );
}

// ── Filings tab ───────────────────────────────────────────────────────────────

function FilingsTab() {
  const [days, setDays] = useState(7);

  const { data: filings, isLoading, error } = useQuery({
    queryKey: ['market-filings', days],
    queryFn: () => edgar.getRecentFilings(days),
    staleTime: 60 * 60 * 1000, // 1h
    retry: 1,
  });

  const fromDate = format(subDays(new Date(), days), 'MMM d');
  const toDate = format(new Date(), 'MMM d');

  return (
    <div>
      {/* Range selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Last</span>
        {[7, 14, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: '4px 10px', borderRadius: 16, cursor: 'pointer',
              fontSize: 12, fontWeight: 500, fontFamily: "'Inter', sans-serif",
              background: days === d ? 'var(--bg-elevated)' : 'transparent',
              color: days === d ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: `1px solid ${days === d ? 'var(--border-default)' : 'transparent'}`,
              transition: 'all 120ms',
            }}
          >
            {d}d
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 4 }}>
          ({fromDate} – {toDate})
        </span>
      </div>

      {isLoading && <Skeleton rows={4} />}

      {error && (
        <p style={{ color: 'var(--color-down)', fontSize: 13 }}>
          Could not load filings. EDGAR may be temporarily unavailable.
        </p>
      )}

      {!isLoading && !error && filings?.length === 0 && (
        <div style={{ padding: '24px 0' }}>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 8 }}>
            No 13D/13G filings found in the last {days} days.
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
                  {/* Form badge */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                    flexShrink: 0, whiteSpace: 'nowrap',
                    background: fc.bg, color: fc.color, border: `1px solid ${fc.border}`,
                    fontFamily: "'Roboto Mono', monospace",
                  }}>
                    {f.formType}
                  </span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Subject company — the stock being acquired/reported on */}
                    {f.subjectCompany && (
                      <p style={{
                        margin: '0 0 2px', fontSize: 13, fontWeight: 600,
                        color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {f.subjectCompany}
                      </p>
                    )}
                    {/* Filer — who filed it (the investor) */}
                    <p style={{
                      margin: 0, fontSize: 12,
                      color: f.subjectCompany ? 'var(--text-secondary)' : 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {f.subjectCompany ? `Filed by ${f.filerName}` : f.filerName}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                      {f.filedDate}
                      {f.periodOfReport && f.periodOfReport !== f.filedDate
                        ? ` · Period: ${f.periodOfReport}` : ''}
                    </p>
                  </div>

                  <ExternalLink size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                </a>
              );
            })}
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
            <span style={{ color: '#F7931A', fontWeight: 600 }}>13D</span> = 5%+ stake with activist intent ·{' '}
            <span style={{ color: 'var(--accent-blue-light)', fontWeight: 600 }}>13G</span> = 5%+ passive stake · Source: SEC EDGAR
          </p>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('news');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'news', label: 'Market News', icon: <Newspaper size={13} /> },
    { id: 'filings', label: '13D / 13G Filings', icon: <FileText size={13} /> },
  ];

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 40px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            margin: '0 0 4px',
            fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em',
          }}>
            Market Signals
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>
            Latest news, activist filings & ownership changes
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 0 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                fontFamily: "'Inter', sans-serif",
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent-blue)' : 'transparent'}`,
                marginBottom: -1,
                transition: 'all 150ms ease-out',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'news' && <NewsTab />}
        {activeTab === 'filings' && <FilingsTab />}
      </div>
    </div>
  );
}
