import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Bot, ExternalLink, Filter, RefreshCw, Search, Star } from 'lucide-react';
import { fetchConvergenceDashboard, type ConvergenceRow, type ConvergenceSignalCell } from '../api/convergence';
import { DataStatus } from '../components/ui/DataStatus';

const SIGNAL_COLUMNS: Array<{ key: keyof ConvergenceRow['signals']; label: string }> = [
  { key: 'news', label: 'News' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'x', label: 'X' },
  { key: 'insider', label: 'Insider' },
  { key: 'congress', label: 'Congress' },
  { key: 'funds', label: 'Funds' },
  { key: 'ownershipFilings', label: '13D/G' },
];

type QuickFilter = 'all' | 'high' | 'multi' | 'fresh';

function scoreColor(score: number) {
  if (score >= 80) return '#F6465D';
  if (score >= 55) return '#F7931A';
  if (score >= 30) return 'var(--accent-blue-light)';
  return 'var(--text-secondary)';
}

function cellTone(cell: ConvergenceSignalCell) {
  if (cell.score >= 16) return { color: '#F6465D', bg: 'rgba(246,70,93,0.10)', border: 'rgba(246,70,93,0.22)' };
  if (cell.score >= 10) return { color: '#F7931A', bg: 'rgba(247,147,26,0.10)', border: 'rgba(247,147,26,0.22)' };
  if (cell.score > 0) return { color: 'var(--accent-blue-light)', bg: 'rgba(45,107,255,0.09)', border: 'rgba(45,107,255,0.18)' };
  return { color: 'var(--text-tertiary)', bg: 'transparent', border: 'var(--border-subtle)' };
}

function SignalCell({ cell }: { cell: ConvergenceSignalCell }) {
  const tone = cellTone(cell);
  return (
    <span
      title={cell.detail || cell.label}
      style={{
        display: 'inline-flex',
        justifyContent: 'center',
        minWidth: 54,
        padding: '3px 6px',
        borderRadius: 6,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontSize: 11,
        fontWeight: 800,
        fontFamily: "'Roboto Mono', monospace",
        whiteSpace: 'nowrap',
      }}
    >
      {cell.label || '-'}
    </span>
  );
}

function formatRecency(value: string | null) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMin = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function topSignalLabels(row: ConvergenceRow) {
  return SIGNAL_COLUMNS
    .map((column) => ({ ...column, cell: row.signals[column.key] }))
    .filter((item) => item.cell.score > 0)
    .sort((a, b) => b.cell.score - a.cell.score)
    .slice(0, 3)
    .map((item) => item.label);
}

function DesktopRow({ row }: { row: ConvergenceRow }) {
  const topSignals = topSignalLabels(row);
  return (
    <tr data-agent-section="convergence-row" data-symbol={row.symbol} style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: '10px 10px' }}>
        <Link to={`/stock/${row.symbol}`} style={{ color: 'var(--text-primary)', fontWeight: 900, fontSize: 13, textDecoration: 'none' }}>
          {row.symbol}
        </Link>
        {row.companyName && row.companyName !== row.symbol && (
          <div style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-tertiary)', fontSize: 11 }}>
            {row.companyName}
          </div>
        )}
      </td>
      <td style={{ padding: '10px 10px' }}>
        <span style={{ color: scoreColor(row.convergenceScore), fontSize: 16, fontWeight: 900, fontFamily: "'Roboto Mono', monospace" }}>
          {row.convergenceScore}
        </span>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 2 }}>{row.sourceCount} src</div>
      </td>
      <td style={{ padding: '10px 10px', minWidth: 300 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
          {row.summary}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
          {topSignals.map((label) => (
            <span key={label} style={{ color: 'var(--accent-blue-light)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
              {label}
            </span>
          ))}
          <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{formatRecency(row.updatedAt)}</span>
        </div>
      </td>
      {SIGNAL_COLUMNS.map((column) => (
        <td key={column.key} style={{ padding: '10px 6px', textAlign: 'center' }}>
          <SignalCell cell={row.signals[column.key]} />
        </td>
      ))}
      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
        <Link to={`/stock/${row.symbol}`} title="Open stock detail" style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>
          <ExternalLink size={14} />
        </Link>
      </td>
    </tr>
  );
}

function MobileRow({ row }: { row: ConvergenceRow }) {
  const topSignals = topSignalLabels(row);
  return (
    <Link data-agent-section="convergence-row-mobile" data-symbol={row.symbol} to={`/stock/${row.symbol}`} style={{ display: 'block', textDecoration: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 900 }}>{row.symbol}</span>
        <span style={{ color: scoreColor(row.convergenceScore), fontSize: 15, fontWeight: 900, fontFamily: "'Roboto Mono', monospace" }}>{row.convergenceScore}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 11 }}>{row.sourceCount} src · {formatRecency(row.updatedAt)}</span>
      </div>
      <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>{row.summary}</p>
      {topSignals.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {topSignals.map((label) => (
            <span key={label} style={{ color: 'var(--accent-blue-light)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
              {label}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {SIGNAL_COLUMNS.filter((column) => row.signals[column.key].score > 0).slice(0, 5).map((column) => (
          <SignalCell key={column.key} cell={row.signals[column.key]} />
        ))}
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['convergence-dashboard'],
    queryFn: () => fetchConvergenceDashboard(80),
    staleTime: 2 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });

  const rows = data?.rows ?? [];
  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter((row) => {
      const matchesQuery = !q || row.symbol.includes(q) || row.companyName.toUpperCase().includes(q) || row.summary.toUpperCase().includes(q);
      if (!matchesQuery) return false;
      if (quickFilter === 'high') return row.convergenceScore >= 70;
      if (quickFilter === 'multi') return row.sourceCount >= 2;
      if (quickFilter === 'fresh') {
        if (!row.updatedAt) return false;
        const updated = new Date(row.updatedAt).getTime();
        return Number.isFinite(updated) && Date.now() - updated <= 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [query, quickFilter, rows]);

  const highConviction = filteredRows.filter((row) => row.convergenceScore >= 70).length;
  const multiSource = filteredRows.filter((row) => row.sourceCount >= 2).length;
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const lead = filteredRows[0] ?? rows[0] ?? null;

  return (
    <div data-agent-section="convergence-dashboard" className="px-3 sm:px-4 md:px-6 pt-3 md:pt-5 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 10 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <Activity size={17} style={{ color: '#F7931A' }} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>Convergence Terminal</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href="/llms.txt" target="_blank" rel="noreferrer" title="Agent instructions" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-tertiary)', fontSize: 12, textDecoration: 'none' }}>
            <Bot size={14} /> Agent
          </a>
          <button onClick={() => refetch()} title="Refresh" style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <RefreshCw size={14} />
          </button>
          <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
        </div>
      </div>

      {lead && !isLoading && !error && (
        <section data-agent-section="top-convergence-signal" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 8, marginBottom: 10 }}>
          <Link to={`/stock/${lead.symbol}`} style={{ display: 'grid', gap: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '11px 12px', textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <Star size={14} style={{ color: '#F7931A', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top convergence</span>
              <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 900 }}>{lead.symbol}</span>
              <span style={{ color: scoreColor(lead.convergenceScore), fontSize: 15, fontWeight: 900, fontFamily: "'Roboto Mono', monospace" }}>{lead.convergenceScore}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 11 }}>{lead.sourceCount} sources · {formatRecency(lead.updatedAt)}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>{lead.summary}</div>
          </Link>
        </section>
      )}

      <div data-agent-section="convergence-controls" className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px_150px] gap-2" style={{ marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0 10px' }}>
          <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, company, or signal" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }} />
        </label>
        <Metric label="Rows" value={String(filteredRows.length)} />
        <Metric label="70+ Score" value={String(highConviction)} />
        <Metric label="Multi-source" value={String(multiSource)} />
      </div>

      <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 6, marginBottom: 6 }}>
        {([
          ['all', 'All'],
          ['high', '70+ score'],
          ['multi', 'Multi-source'],
          ['fresh', 'Fresh 24H'],
        ] as Array<[QuickFilter, string]>).map(([id, label]) => {
          const active = quickFilter === id;
          return (
            <button
              key={id}
              onClick={() => setQuickFilter(id)}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 10px',
                borderRadius: 7,
                border: `1px solid ${active ? 'rgba(247,147,26,0.42)' : 'var(--border-subtle)'}`,
                background: active ? 'rgba(247,147,26,0.12)' : 'var(--bg-surface)',
                color: active ? '#F7931A' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Filter size={12} />
              {label}
            </button>
          );
        })}
      </div>

      {data?.note && (
        <p style={{ margin: '0 0 10px', color: 'var(--text-tertiary)', fontSize: 12 }}>{data.note}</p>
      )}

      {isLoading ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="animate-pulse" style={{ height: 42, borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }} />
          ))}
        </div>
      ) : error ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 8, padding: 14, color: 'var(--text-secondary)' }}>
          Convergence data could not be loaded: {(error as Error).message}
        </div>
      ) : filteredRows.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 14, color: 'var(--text-secondary)' }}>
          No convergence rows match this filter.
        </div>
      ) : (
        <>
          <div data-agent-section="convergence-table" className="hidden md:block" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Th>Ticker</Th>
                  <Th>Score</Th>
                  <Th>Why Now</Th>
                  {SIGNAL_COLUMNS.map((column) => <Th key={column.key} align="center">{column.label}</Th>)}
                  <Th align="right">Open</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => <DesktopRow key={row.symbol} row={row} />)}
              </tbody>
            </table>
          </div>
          <div data-agent-section="convergence-mobile-list" className="grid md:hidden" style={{ gap: 8 }}>
            {filteredRows.map((row) => <MobileRow key={row.symbol} row={row} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ height: 38, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '5px 9px' }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 900, fontFamily: "'Roboto Mono', monospace" }}>{value}</div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'center' | 'right' }) {
  return <th style={{ padding: '8px 10px', textAlign: align, fontWeight: 900 }}>{children}</th>;
}
