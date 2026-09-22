import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import { DataStatus } from '../components/ui/DataStatus';
import { useOwnershipFilings } from '../hooks/useOwnershipFilings';
import type { InvestorType, OwnershipFilingSignal } from '../api/ownershipFilings';

type InvestorFilter = InvestorType | 'all';

function ShellCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 18 }}>
      <div style={{ width: 120, height: 10, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 12 }} />
      <div style={{ width: '78%', height: 14, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 10 }} />
      <div style={{ width: '100%', height: 11, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 8 }} />
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>{subtitle}</p>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'hot' | 'good' }) {
  const color = tone === 'hot' ? '#F6465D' : tone === 'good' ? '#079A6A' : 'var(--text-primary)';
  const border = tone === 'hot' ? 'rgba(246, 70, 93, 0.24)' : tone === 'good' ? 'rgba(7, 154, 106, 0.24)' : 'var(--border-subtle)';
  return (
    <div style={{ background: 'var(--bg-surface)', border: `1px solid ${border}`, borderRadius: 16, padding: 14 }}>
      <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color }}>{value}</p>
    </div>
  );
}

const INVESTOR_TYPE_META: Record<InvestorType, { label: string; color: string; background: string; border: string }> = {
  activist: { label: 'Activist', color: '#F6465D', background: 'rgba(246, 70, 93, 0.12)', border: 'rgba(246, 70, 93, 0.24)' },
  strategic_acquirer: { label: 'Strategic', color: '#2F80ED', background: 'rgba(47, 128, 237, 0.12)', border: 'rgba(47, 128, 237, 0.24)' },
  passive_index: { label: 'Passive', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', border: 'var(--border-subtle)' },
  other: { label: 'Other', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', border: 'var(--border-subtle)' },
};

function InvestorTypeBadge({ type }: { type: InvestorType | null }) {
  const meta = type ? INVESTOR_TYPE_META[type] : null;
  if (!meta) return <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Unscored</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: meta.color, background: meta.background, border: `1px solid ${meta.border}` }}>
      {meta.label}
    </span>
  );
}

function materialityMeta(score: number | null) {
  if (score == null) return { label: 'Unscored', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', border: 'var(--border-subtle)' };
  if (score >= 2.5) return { label: 'Highly significant', color: '#F6465D', background: 'rgba(246, 70, 93, 0.12)', border: 'rgba(246, 70, 93, 0.24)' };
  if (score >= 1.75) return { label: 'Significant', color: '#F7931A', background: 'rgba(247, 147, 26, 0.12)', border: 'rgba(247, 147, 26, 0.24)' };
  if (score >= 0.75) return { label: 'Notable', color: '#2F80ED', background: 'rgba(47, 128, 237, 0.12)', border: 'rgba(47, 128, 237, 0.24)' };
  return { label: 'Routine', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', border: 'var(--border-subtle)' };
}

function MaterialityBadge({ score, confidence }: { score: number | null; confidence: number | null }) {
  const meta = materialityMeta(score);
  const confPct = confidence != null ? `${Math.round(confidence * 100)}% conf.` : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: meta.color, background: meta.background, border: `1px solid ${meta.border}` }}>
      {meta.label}
      {confPct && <span style={{ fontWeight: 500, opacity: 0.8 }}>· {confPct}</span>}
    </span>
  );
}

function formatFiledDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function FilingCard({ signal }: { signal: OwnershipFilingSignal }) {
  const thesis = signal.llm_thesis;
  const isAmendment = signal.form_type.includes('/A');
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 16 }}>
      <div className="flex flex-wrap items-start justify-between gap-2" style={{ marginBottom: 8 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
            {signal.symbol ? (
              <Link to={`/stock/${signal.symbol}`} style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>
                {signal.symbol}
              </Link>
            ) : (
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{signal.subject_company}</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              {signal.form_type}
            </span>
            {signal.new_position != null && signal.new_position >= 0.6 && (
              <span title="Likely a brand-new position" style={{ fontSize: 11, fontWeight: 700, color: '#079A6A' }}>New position</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {signal.symbol ? signal.subject_company : null}{signal.symbol ? ' — ' : ''}
            filed by <strong style={{ color: 'var(--text-primary)' }}>{signal.filer_name}</strong>
            {isAmendment ? ' (amendment)' : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatFiledDate(signal.filed_date)}</span>
          <a href={signal.filing_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--accent-blue)' }}>
            View filing <ExternalLink size={11} />
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: thesis ? 10 : 0 }}>
        <InvestorTypeBadge type={signal.investor_type} />
        <MaterialityBadge score={signal.materiality_score} confidence={signal.materiality_confidence} />
        {signal.board_or_strategic_intent != null && signal.board_or_strategic_intent >= 0.6 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#F7931A' }}>
            <ShieldAlert size={12} /> Board/strategic intent
          </span>
        )}
        {signal.escalated && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--accent-blue)' }}>
            <Sparkles size={12} /> AI thesis
          </span>
        )}
      </div>

      {thesis && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 12, marginTop: 4 }}>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 6 }}>
            {thesis.signal && (
              <span style={{ fontSize: 11, fontWeight: 800, color: thesis.signal === 'BULLISH' ? '#079A6A' : thesis.signal === 'BEARISH' ? '#F6465D' : 'var(--text-secondary)' }}>
                {thesis.signal}
              </span>
            )}
            {thesis.conviction && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>· {thesis.conviction} conviction</span>}
            {thesis.ownership?.currentStake && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>· {thesis.ownership.currentStake} stake</span>}
          </div>
          {thesis.thesis && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>{thesis.thesis}</p>}
        </div>
      )}
    </div>
  );
}

const INVESTOR_FILTERS: { id: InvestorFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'activist', label: 'Activist' },
  { id: 'strategic_acquirer', label: 'Strategic' },
  { id: 'passive_index', label: 'Passive' },
];

export default function OwnershipFilingsPage() {
  const [investorType, setInvestorType] = useState<InvestorFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [days, setDays] = useState<7 | 14 | 30>(14);

  const { data, error, isLoading, isFetching, dataUpdatedAt } = useOwnershipFilings({
    minMateriality: showAll ? 0 : 0.75,
    investorType: investorType === 'all' ? undefined : investorType,
    days,
    escalatedOnly,
    limit: 150,
  });

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const signals = data?.signals ?? [];

  const stats = useMemo(() => {
    const escalated = signals.filter((s) => s.escalated).length;
    const activist = signals.filter((s) => s.investor_type === 'activist').length;
    const newPositions = signals.filter((s) => (s.new_position ?? 0) >= 0.6).length;
    return { escalated, activist, newPositions };
  }, [signals]);

  return (
    <div data-agent-section="ownership-filings-page" className="px-3 sm:px-4 md:px-8 pt-4 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <Radar size={18} style={{ color: 'var(--accent-blue-light)' }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>13D/13G Triage</h1>
        </div>
        <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
      </div>

      <p className="hidden md:block" style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 760 }}>
        Every new beneficial-ownership filing is triaged by Jev (fast structured classification), and the small
        slice that clears the materiality bar gets a full AI thesis. Routine passive threshold crossings are hidden by default.
      </p>

      <div data-agent-section="ownership-filing-filters" className="flex flex-wrap items-center gap-2" style={{ marginBottom: 14 }}>
        {INVESTOR_FILTERS.map((option) => {
          const active = investorType === option.id;
          return (
            <button
              key={option.id}
              onClick={() => setInvestorType(option.id)}
              style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`, background: active ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)', color: active ? 'var(--accent-blue-light)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {option.label}
            </button>
          );
        })}
        {([7, 14, 30] as const).map((option) => {
          const active = days === option;
          return (
            <button key={option} onClick={() => setDays(option)} style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`, background: active ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)', color: active ? 'var(--accent-blue-light)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {option}D
            </button>
          );
        })}
        <button
          onClick={() => setShowAll((c) => !c)}
          style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${showAll ? 'rgba(247,147,26,0.4)' : 'var(--border-default)'}`, background: showAll ? 'rgba(247,147,26,0.12)' : 'var(--bg-elevated)', color: showAll ? '#F7931A' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {showAll ? 'All (incl. routine)' : 'Notable+ only'}
        </button>
        <button
          onClick={() => setEscalatedOnly((c) => !c)}
          style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${escalatedOnly ? 'var(--accent-blue)' : 'var(--border-default)'}`, background: escalatedOnly ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)', color: escalatedOnly ? 'var(--accent-blue-light)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          AI thesis only
        </button>
      </div>

      <div data-agent-section="ownership-filing-metrics" className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3" style={{ marginBottom: 18 }}>
        <SummaryCard label="In view" value={String(signals.length)} tone="neutral" />
        <SummaryCard label="AI thesis" value={String(stats.escalated)} tone="hot" />
        <SummaryCard label="Activist" value={String(stats.activist)} tone="hot" />
        <SummaryCard label="New positions" value={String(stats.newPositions)} tone="good" />
      </div>

      {data?.error && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(247, 147, 26, 0.24)', borderRadius: 16, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{data.error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ShellCard title="Loading triaged filings" subtitle="Pulling the ranked 13D/13G feed for the current filter set" />
          <ShellCard title="Applying materiality floor" subtitle="Routine passive crossings are hidden by default" />
        </div>
      ) : error ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 18, padding: 18 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Ownership filing triage is wired, but the feed could not be loaded right now.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoint: <code>/api/ownership-filings/triage</code>
          </p>
        </div>
      ) : signals.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>No filings match this filter yet.</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Triage runs on a schedule once <code>TYPESAFE_API_KEY</code> and <code>OWNERSHIP_TRIAGE_ENABLED=1</code> are set. Try widening the date range or turning off "Notable+ only".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {signals.map((signal) => (
            <FilingCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
