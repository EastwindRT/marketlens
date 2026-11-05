import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ExternalLink, Layers, Sparkles } from 'lucide-react';
import { DataStatus } from '../components/ui/DataStatus';
import { useFilingsFeed } from '../hooks/useFilingsFeed';
import type { FilingSignal, FilingThesis, FilingType, PriorityTier } from '../api/filings';

type TypeFilter = FilingType | 'all';
type TierFilter = PriorityTier | 'all';

const TYPE_META: Record<FilingType, { label: string; color: string }> = {
  ownership: { label: '13D/13G', color: '#2F80ED' },
  insider: { label: 'Form 4', color: '#079A6A' },
  event: { label: '8-K', color: '#F7931A' },
};

const TIER_META: Record<PriorityTier, { label: string; color: string; background: string }> = {
  critical: { label: 'Critical', color: '#F6465D', background: 'rgba(246, 70, 93, 0.14)' },
  high: { label: 'High', color: '#F7931A', background: 'rgba(247, 147, 26, 0.14)' },
  medium: { label: 'Medium', color: '#2F80ED', background: 'rgba(47, 128, 237, 0.14)' },
  low: { label: 'Low', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)' },
};

const EVENT_LABELS: Record<string, string> = {
  earnings: 'Earnings',
  mna: 'M&A',
  leadership_change: 'Leadership change',
  financing: 'Financing',
  guidance_or_warning: 'Guidance / warning',
  regulatory_legal: 'Regulatory / legal',
  distress: 'Distress',
  material_agreement: 'Material agreement',
  routine: 'Routine',
};

const INVESTOR_LABELS: Record<string, string> = {
  activist: 'Activist',
  passive_index: 'Passive',
  strategic_acquirer: 'Strategic',
  other: 'Other',
};

const ROLE_LABELS: Record<string, string> = {
  executive: 'Executive',
  director: 'Director',
  ten_percent_owner: '10% owner',
  other: 'Insider',
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatUsd(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

// Short human summary of the type-specific Jev answers; also returns flag chips.
function describeSignal(s: FilingSignal): { summary: string; flags: string[] } {
  const f = s.signals || {};
  const flags: string[] = [];
  if (f.scored_by === 'rules') {
    if (f.cluster_buy) flags.push('Cluster buy');
    if (f.is_executive) flags.push('Executive');
    return { summary: String(f.rule_reason || 'Rule-based score'), flags };
  }
  if (s.filing_type === 'ownership') {
    if ((num(f.board_or_strategic_intent) ?? 0) >= 0.6) flags.push('Board / strategic intent');
    if ((num(f.new_position) ?? 0) >= 0.6) flags.push('New position');
    if ((num(f.mechanical_crossing) ?? 0) >= 0.7) flags.push('Mechanical crossing');
    return { summary: `${INVESTOR_LABELS[String(f.investor_type)] ?? 'Unclassified'} holder filed by ${s.filer_name}`, flags };
  }
  if (s.filing_type === 'insider') {
    if (f.cluster_buy) flags.push('Cluster buy');
    if ((num(f.conviction_buy) ?? 0) >= 0.7) flags.push('Conviction buy');
    if ((num(f.pre_arranged_plan) ?? 0) >= 0.7) flags.push('10b5-1 plan');
    const value = num(f.total_value);
    const role = ROLE_LABELS[String(f.insider_role)] ?? 'Insider';
    return { summary: `${s.filer_name} (${role})${value ? ` - ${formatUsd(value)}` : ''}`, flags };
  }
  if ((num(f.adverse_surprise) ?? 0) >= 0.7) flags.push('Adverse surprise');
  if ((num(f.positive_catalyst) ?? 0) >= 0.7) flags.push('Positive catalyst');
  return { summary: EVENT_LABELS[String(f.event_category)] ?? '8-K current report', flags };
}

function thesisText(t: FilingThesis): { head: string | null; body: string | null; facts: string[] } {
  return {
    head: t.headline ?? null,
    body: t.why_it_matters ?? t.thesis ?? null,
    facts: [...(t.key_facts ?? []), ...(t.context_flags ?? [])].slice(0, 5),
  };
}

function glossaryAnchor(s: FilingSignal): string {
  if (s.filing_type === 'insider') return 'form-4';
  if (s.filing_type === 'event') return 'form-8k';
  return s.form_type.toUpperCase().includes('13G') ? 'sch-13g' : 'sch-13d';
}

function formatFiledDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`,
        background: active ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)',
        color: active ? 'var(--accent-blue-light)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 14 }}>
      <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: color ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function PriorityBadge({ priority, tier }: { priority: number; tier: PriorityTier }) {
  const meta = TIER_META[tier];
  return (
    <div title={`${meta.label} priority`} style={{ minWidth: 48, textAlign: 'center', padding: '6px 8px', borderRadius: 10, background: meta.background, color: meta.color, flexShrink: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1 }}>{priority}</div>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{meta.label}</div>
    </div>
  );
}

function FilingRow({ signal }: { signal: FilingSignal }) {
  const [open, setOpen] = useState(false);
  const type = TYPE_META[signal.filing_type];
  const { summary, flags } = describeSignal(signal);
  const thesis = signal.llm_thesis ? thesisText(signal.llm_thesis) : null;

  return (
    <div
      data-agent-section="filing-row"
      data-symbol={signal.symbol ?? undefined}
      data-accession={signal.accession_no}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 12 }}
    >
      <div className="flex items-start gap-3">
        <PriorityBadge priority={signal.priority} tier={signal.priority_tier} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 3 }}>
            {signal.symbol ? (
              <Link to={`/stock/${signal.symbol}`} style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>
                {signal.symbol}
              </Link>
            ) : null}
            <Link
              to={`/glossary#${glossaryAnchor(signal)}`}
              title={`What is a ${type.label}?`}
              style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: type.color, border: `1px solid ${type.color}33`, background: `${type.color}14`, textDecoration: 'none' }}
            >
              {type.label}{signal.form_type.includes('/A') ? ' /A' : ''}
            </Link>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatFiledDate(signal.filed_date)}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {signal.subject_company}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{summary}</p>
          {(flags.length > 0 || signal.escalated) && (
            <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 6 }}>
              {flags.map((flag) => (
                <span key={flag} style={{ fontSize: 11, fontWeight: 700, color: '#F7931A' }}>{flag}</span>
              ))}
              {signal.escalated && (
                <button
                  onClick={() => setOpen((v) => !v)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--accent-blue)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <Sparkles size={12} /> {open ? 'Hide AI read' : 'AI read'}
                </button>
              )}
            </div>
          )}
        </div>
        <a href={signal.filing_url} target="_blank" rel="noreferrer" title="View on SEC.gov" style={{ color: 'var(--accent-blue)', flexShrink: 0, padding: 4 }}>
          <ExternalLink size={14} />
        </a>
      </div>

      {open && thesis && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, marginTop: 10 }}>
          {thesis.head && <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{thesis.head}</p>}
          {thesis.body && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>{thesis.body}</p>}
          {thesis.facts.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 16, listStyle: 'disc', fontSize: 12, color: 'var(--text-secondary)' }}>
              {thesis.facts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All types' },
  { id: 'ownership', label: '13D/13G' },
  { id: 'insider', label: 'Form 4' },
  { id: 'event', label: '8-K' },
];

const TIER_FILTERS: { id: TierFilter; label: string }[] = [
  { id: 'all', label: 'Any priority' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
];

export default function FilingsPage() {
  const [type, setType] = useState<TypeFilter>('all');
  const [tier, setTier] = useState<TierFilter>('all');
  const [days, setDays] = useState<1 | 3 | 7 | 14 | 30>(3);
  const [includeLow, setIncludeLow] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [ticker, setTicker] = useState('');

  const symbols = ticker.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const { data, error, isLoading, isFetching, dataUpdatedAt } = useFilingsFeed({
    types: type === 'all' ? undefined : [type],
    tier: tier === 'all' ? undefined : tier,
    minPriority: includeLow || tier !== 'all' ? undefined : 25,
    days,
    escalatedOnly,
    symbols: symbols.length ? symbols : undefined,
    limit: 200,
  });

  const signals = useMemo(() => data?.signals ?? [], [data]);
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const counts = useMemo(() => ({
    critical: signals.filter((s) => s.priority_tier === 'critical').length,
    high: signals.filter((s) => s.priority_tier === 'high').length,
    ai: signals.filter((s) => s.escalated).length,
  }), [signals]);

  return (
    <div data-agent-section="filings-page" className="px-3 sm:px-4 md:px-8 pt-4 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <Layers size={18} style={{ color: 'var(--accent-blue-light)' }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Filings</h1>
        </div>
        <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
      </div>
      <p className="hidden md:block" style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 760 }}>
        Every new SEC 13D/13G, Form 4 and 8-K is scored 0-100 (by Jev when connected, otherwise by rules), and filings
        with no real impact are filtered out. Only those that clear their type's bar get a written AI read. Low-priority
        filings are hidden by default.{' '}
        <Link to="/glossary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-blue)', fontWeight: 700, textDecoration: 'none' }}>
          <BookOpen size={13} /> What do these filings mean?
        </Link>
      </p>

      <div data-agent-section="filings-filters" className="flex flex-wrap items-center gap-2" style={{ marginBottom: 10 }}>
        {TYPE_FILTERS.map((o) => <Chip key={o.id} active={type === o.id} onClick={() => setType(o.id)}>{o.label}</Chip>)}
      </div>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 14 }}>
        {TIER_FILTERS.map((o) => <Chip key={o.id} active={tier === o.id} onClick={() => setTier(o.id)}>{o.label}</Chip>)}
        {([1, 3, 7, 14, 30] as const).map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d}D</Chip>)}
        <Chip active={includeLow} onClick={() => setIncludeLow((v) => !v)}>Include low</Chip>
        <Chip active={escalatedOnly} onClick={() => setEscalatedOnly((v) => !v)}>AI read only</Chip>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Tickers, e.g. NVDA, TSLA"
          aria-label="Filter by tickers"
          style={{ width: 190, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}
        />
      </div>

      <div data-agent-section="filings-metrics" className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3" style={{ marginBottom: 18 }}>
        <Metric label="In view" value={signals.length} />
        <Metric label="Critical" value={counts.critical} color="#F6465D" />
        <Metric label="High" value={counts.high} color="#F7931A" />
        <Metric label="AI read" value={counts.ai} color="var(--accent-blue)" />
      </div>

      {data?.triageMode === 'rules' && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Rule-based scoring.</strong> No Jev key is connected, so obvious noise
            (routine 8-K items, small or mechanical insider trades, passive 13G filings from index funds) is filtered by rules and the rest
            is ranked by form type, item codes and trade size. Add a Jev key for text-aware scoring and AI reads.
          </p>
        </div>
      )}

      {data?.error && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(247, 147, 26, 0.24)', borderRadius: 16, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{data.error}</p>
        </div>
      )}

      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading triaged filings...</p>
      ) : error ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 18, padding: 18 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>The filings feed could not be loaded right now.</p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>Expected endpoint: <code>/api/filings/feed</code></p>
        </div>
      ) : signals.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>No filings match this filter yet.</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Triage runs on a schedule once <code>TYPESAFE_API_KEY</code> and <code>FILING_TRIAGE_ENABLED=1</code> are set. Try a wider window or turn on "Include low".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {signals.map((s) => <FilingRow key={s.id} signal={s} />)}
        </div>
      )}
    </div>
  );
}
