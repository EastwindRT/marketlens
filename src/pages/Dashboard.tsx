import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bot,
  CalendarClock,
  Layers3,
  LineChart,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { fetchConvergenceDashboard, type ConvergenceRow } from '../api/convergence';
import { DataStatus } from '../components/ui/DataStatus';

const SIGNAL_COLUMNS: Array<{ key: keyof ConvergenceRow['signals']; label: string; color: string }> = [
  { key: 'reddit', label: 'Reddit', color: '#C05AD9' },
  { key: 'x', label: 'X', color: '#2F80ED' },
  { key: 'insider', label: 'Insider', color: '#079A6A' },
  { key: 'ownershipFilings', label: '13D/G', color: '#D8622C' },
  { key: 'funds', label: 'Funds', color: '#7A5CE1' },
  { key: 'news', label: 'News', color: '#E06894' },
  { key: 'congress', label: 'Congress', color: '#28AFC7' },
];

const THEMES = [
  'All',
  'AI Cloud',
  'Semis',
  'Power & Grid',
  'Activist / 13D',
  'Insider Accumulation',
  'Social Acceleration',
  'Canada',
  'Outliers',
] as const;

type ThemeFilter = typeof THEMES[number];
type ViewMode = 'watchlist' | 'baskets' | 'catalysts' | 'theses';

function scoreColor(score: number) {
  if (score >= 80) return '#D94A55';
  if (score >= 60) return '#D8622C';
  if (score >= 35) return '#079A6A';
  return 'var(--text-secondary)';
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

function dominantSignals(row: ConvergenceRow) {
  return SIGNAL_COLUMNS
    .map((column) => ({ ...column, cell: row.signals[column.key] }))
    .filter((item) => item.cell.score > 0)
    .sort((a, b) => b.cell.score - a.cell.score)
    .slice(0, 4);
}

function inferTheme(row: ConvergenceRow): ThemeFilter {
  const text = `${row.symbol} ${row.companyName} ${row.summary} ${row.reasons.join(' ')}`.toLowerCase();
  if (row.symbol.endsWith('.TO') || /canada|tsx|sedar|tmx/.test(text)) return 'Canada';
  if (/13d|13g|activist|ownership|stake/.test(text)) return 'Activist / 13D';
  if (/insider|form 4|buying|sell/.test(text)) return 'Insider Accumulation';
  if (/reddit|x trend|social|mention|accelerat/.test(text)) return 'Social Acceleration';
  if (/power|grid|utility|nuclear|uranium|energy/.test(text)) return 'Power & Grid';
  if (/chip|semi|nvda|amd|asml|tsm|memory|hbm|silicon|substrate|photonics/.test(text)) return 'Semis';
  if (/ai|cloud|data center|gpu|compute|server/.test(text)) return 'AI Cloud';
  return 'Outliers';
}

function themeColor(theme: ThemeFilter) {
  switch (theme) {
    case 'AI Cloud': return '#4E7CE8';
    case 'Semis': return '#C05AD9';
    case 'Power & Grid': return '#DCA23A';
    case 'Activist / 13D': return '#D8622C';
    case 'Insider Accumulation': return '#079A6A';
    case 'Social Acceleration': return '#28AFC7';
    case 'Canada': return '#E06894';
    case 'Outliers': return '#8B94A5';
    default: return '#1E2A44';
  }
}

function buildThesis(row: ConvergenceRow, theme: ThemeFilter) {
  const signals = dominantSignals(row).map((signal) => signal.label).join(' + ');
  if (row.summary) return row.summary;
  return `${theme} setup with ${signals || `${row.sourceCount} source`} confirmation.`;
}

export default function Dashboard() {
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<ThemeFilter>('All');
  const [viewMode, setViewMode] = useState<ViewMode>('watchlist');
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['convergence-dashboard'],
    queryFn: () => fetchConvergenceDashboard(90),
    staleTime: 2 * 60 * 1000,
    retry: 1,
    placeholderData: (previous) => previous,
  });

  const rows = data?.rows ?? [];
  const enrichedRows = useMemo(() => rows.map((row) => ({ row, theme: inferTheme(row) })), [rows]);
  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return enrichedRows.filter((item) => {
      const row = item.row;
      const matchesTheme = theme === 'All' || item.theme === theme;
      const matchesQuery = !q
        || row.symbol.includes(q)
        || row.companyName.toUpperCase().includes(q)
        || row.summary.toUpperCase().includes(q)
        || item.theme.toUpperCase().includes(q);
      if (!matchesTheme || !matchesQuery) return false;
      if (viewMode === 'catalysts') return dominantSignals(row).length > 0;
      if (viewMode === 'theses') return row.convergenceScore >= 35 || row.sourceCount >= 2;
      return true;
    });
  }, [enrichedRows, query, theme, viewMode]);

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const topRow = rows[0] ?? null;
  const multiSource = rows.filter((row) => row.sourceCount >= 2).length;
  const basketCount = new Set(enrichedRows.map((item) => item.theme).filter((name) => name !== 'Outliers')).size;
  const topMover = topRow ? `${topRow.symbol} ${topRow.convergenceScore}` : '-';

  return (
    <div data-agent-section="convergence-dashboard" className="px-3 sm:px-5 md:px-7 pt-4 md:pt-6 pb-10" style={{ minHeight: '100%' }}>
      <header className="flex flex-wrap items-center gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: '#FFFFFF', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-soft)' }}>
            <Sparkles size={17} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, lineHeight: 1.05, fontWeight: 900 }}>Alpha Workbench</h1>
            <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 3 }}>convergence research - agent friendly</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href="/llms.txt" target="_blank" rel="noreferrer" title="Agent guide" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>
            <Bot size={15} /> Agent
          </a>
          <button onClick={() => refetch()} title="Refresh" style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <RefreshCw size={15} />
          </button>
          <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
        </div>
      </header>

      <section data-agent-section="convergence-metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" style={{ marginBottom: 18 }}>
        <TopMetric icon={<Layers3 size={18} />} label="Names tracked" value={String(rows.length)} tone="#2F80ED" />
        <TopMetric icon={<Activity size={18} />} label="Theme baskets" value={String(basketCount)} tone="#D8622C" />
        <TopMetric icon={<LineChart size={18} />} label="Multi-source" value={String(multiSource)} tone="#079A6A" />
        <TopMetric icon={<TrendingUp size={18} />} label="Top signal" value={topMover} tone="#D94A55" />
      </section>

      <nav data-agent-section="alpha-workbench-tabs" className="flex overflow-x-auto" style={{ gap: 4, marginBottom: 20 }}>
        <TabButton active={viewMode === 'watchlist'} icon={<Activity size={16} />} label="Watchlist" onClick={() => setViewMode('watchlist')} />
        <TabButton active={viewMode === 'baskets'} icon={<Layers3 size={16} />} label="Theme baskets" onClick={() => setViewMode('baskets')} />
        <TabButton active={viewMode === 'catalysts'} icon={<CalendarClock size={16} />} label="Catalysts" onClick={() => setViewMode('catalysts')} />
        <TabButton active={viewMode === 'theses'} icon={<Sparkles size={16} />} label="Theses" onClick={() => setViewMode('theses')} />
      </nav>

      <section data-agent-section="convergence-controls" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, boxShadow: 'var(--shadow-soft)', overflow: 'hidden' }}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,430px)_1fr_auto] gap-3" style={{ padding: '18px 20px 14px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, background: '#FBFAF8', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '0 14px' }}>
            <Search size={17} style={{ color: 'var(--text-tertiary)' }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, name, theme..." style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }} />
          </label>
          <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            click any ticker to open detail
          </div>
          <div className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12, justifySelf: 'end' }}>
            {filteredRows.length} names
          </div>
        </div>

        <div data-agent-section="theme-buckets" style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '0 20px 18px' }}>
          {THEMES.map((item) => {
            const active = theme === item;
            const color = themeColor(item);
            const count = item === 'All' ? rows.length : enrichedRows.filter((row) => row.theme === item).length;
            return (
              <button
                key={item}
                onClick={() => setTheme(item)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 30,
                  padding: '0 11px',
                  borderRadius: 999,
                  border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
                  background: active ? '#1E2A44' : '#FFFFFF',
                  color: active ? '#FFFFFF' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {item !== 'All' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
                {item}
                <span className="mono" style={{ opacity: 0.72 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {data?.note && (
          <p style={{ margin: '0 20px 14px', color: 'var(--text-tertiary)', fontSize: 12 }}>{data.note}</p>
        )}

        {isLoading ? (
          <div style={{ display: 'grid', gap: 1, padding: '0 20px 20px' }}>
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ height: 58, borderRadius: 0 }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ margin: 20, border: '1px solid rgba(217,74,85,0.25)', borderRadius: 10, padding: 14, color: 'var(--text-secondary)' }}>
            Convergence data could not be loaded: {(error as Error).message}
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ margin: 20, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, color: 'var(--text-secondary)' }}>
            No names match this workbench filter.
          </div>
        ) : (
          <>
            <div data-agent-section="convergence-table" className="hidden md:block" style={{ overflow: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
                <thead>
                  <tr style={{ background: '#FBFAF8', color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    <Th>Ticker</Th>
                    <Th>Theme</Th>
                    <Th align="center">Conv.</Th>
                    <Th>Evidence</Th>
                    <Th>Thesis</Th>
                    <Th align="right">Updated</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ row, theme }) => <DesktopRow key={row.symbol} row={row} theme={theme} />)}
                </tbody>
              </table>
            </div>
            <div data-agent-section="convergence-mobile-list" className="grid md:hidden" style={{ gap: 10, padding: '0 14px 16px' }}>
              {filteredRows.map(({ row, theme }) => <MobileRow key={row.symbol} row={row} theme={theme} />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TopMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: string }) {
  return (
    <div style={{ minHeight: 106, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderTop: `3px solid ${tone}`, borderRadius: 13, padding: '18px 20px', boxShadow: 'var(--shadow-soft)', display: 'grid', alignContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-tertiary)' }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.18em' }}>{label}</span>
        {icon}
      </div>
      <div className="mono" style={{ color: tone, fontSize: 28, lineHeight: 1, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 42,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
        borderRadius: 11,
        border: `1px solid ${active ? 'var(--border-subtle)' : 'transparent'}`,
        background: active ? 'var(--bg-surface)' : 'transparent',
        boxShadow: active ? '0 3px 12px rgba(32,37,50,0.06)' : 'none',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: 800,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function DesktopRow({ row, theme }: { row: ConvergenceRow; theme: ThemeFilter }) {
  const signals = dominantSignals(row);
  return (
    <tr data-agent-section="convergence-row" data-symbol={row.symbol} style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: '16px 20px' }}>
        <Link to={`/stock/${row.symbol}`} style={{ color: 'var(--text-primary)', fontWeight: 900, fontSize: 14 }}>{row.symbol}</Link>
        {row.companyName && row.companyName !== row.symbol && (
          <div style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
            {row.companyName}
          </div>
        )}
      </td>
      <td style={{ padding: '16px 12px' }}>
        <ThemePill theme={theme} />
      </td>
      <td style={{ padding: '16px 12px', textAlign: 'center' }}>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 64, height: 34, borderRadius: 999, border: '1px solid #BCC5D4', background: '#E8EDF5', color: scoreColor(row.convergenceScore), fontWeight: 900, fontSize: 13 }}>
          {row.convergenceScore}
        </span>
        <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 4 }}>{row.sourceCount} src</div>
      </td>
      <td style={{ padding: '16px 12px', minWidth: 260 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {signals.length > 0 ? signals.map((signal) => <SignalBadge key={signal.key} label={signal.label} score={signal.cell.score} color={signal.color} />) : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No strong evidence yet</span>}
        </div>
      </td>
      <td style={{ padding: '16px 12px', minWidth: 340 }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.45, fontWeight: 600 }}>
          {buildThesis(row, theme)}
        </div>
        {row.conflicts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-down)', fontSize: 11, marginTop: 7, fontWeight: 800 }}>
            <TrendingDown size={12} /> review conflict
          </div>
        )}
      </td>
      <td className="mono" style={{ padding: '16px 20px', textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 12 }}>
        {formatRecency(row.updatedAt)}
      </td>
    </tr>
  );
}

function MobileRow({ row, theme }: { row: ConvergenceRow; theme: ThemeFilter }) {
  const signals = dominantSignals(row);
  return (
    <Link data-agent-section="convergence-row-mobile" data-symbol={row.symbol} to={`/stock/${row.symbol}`} style={{ display: 'block', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14, background: '#FFFFFF', boxShadow: '0 5px 16px rgba(32,37,50,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 900 }}>{row.symbol}</span>
        <ThemePill theme={theme} />
        <span className="mono" style={{ marginLeft: 'auto', color: scoreColor(row.convergenceScore), fontSize: 15, fontWeight: 900 }}>{row.convergenceScore}</span>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>{buildThesis(row, theme)}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {signals.map((signal) => <SignalBadge key={signal.key} label={signal.label} score={signal.cell.score} color={signal.color} />)}
      </div>
      <div className="mono" style={{ marginTop: 10, color: 'var(--text-tertiary)', fontSize: 11 }}>{row.sourceCount} sources - {formatRecency(row.updatedAt)}</div>
    </Link>
  );
}

function ThemePill({ theme }: { theme: ThemeFilter }) {
  const color = themeColor(theme);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {theme}
    </span>
  );
}

function SignalBadge({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <span title={`${label}: ${score}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 24, padding: '0 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', background: '#FFFFFF', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}
      <span className="mono" style={{ color: 'var(--text-tertiary)' }}>{score}</span>
    </span>
  );
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'center' | 'right' }) {
  return <th style={{ padding: '13px 20px', textAlign: align, fontWeight: 900 }}>{children}</th>;
}
