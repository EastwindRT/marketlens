import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import {
  COVERAGE_META, EIGHT_K_ITEMS, FORM_4_CODES, GLOSSARY, PRIORITY_TIERS,
  type Coverage, type GlossaryEntry, type Market, type Weight,
} from '../data/filingGlossary';

type CoverageFilter = Coverage | 'all';
type MarketFilter = Market | 'all';

const COVERAGE_COLOR: Record<Coverage, string> = {
  triaged: '#079A6A',
  shown: '#2F80ED',
  not_covered: 'var(--text-tertiary)',
};

const WEIGHT_META: Record<Weight, { label: string; color: string; background: string }> = {
  high: { label: 'High', color: '#F6465D', background: 'rgba(246, 70, 93, 0.12)' },
  medium: { label: 'Medium', color: '#F7931A', background: 'rgba(247, 147, 26, 0.12)' },
  low: { label: 'Low', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)' },
};

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

function WeightBadge({ weight }: { weight: Weight }) {
  const m = WEIGHT_META[weight];
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: m.color, background: m.background }}>
      {m.label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</p>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function EntryCard({ entry, open, onToggle }: { entry: GlossaryEntry; open: boolean; onToggle: () => void }) {
  const color = COVERAGE_COLOR[entry.coverage];
  return (
    <div id={entry.id} data-agent-section="glossary-entry" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 14, scrollMarginTop: 16 }}>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{entry.form}</h2>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color, border: `1px solid ${color}`, opacity: entry.coverage === 'not_covered' ? 0.8 : 1 }}>
          {COVERAGE_META[entry.coverage].label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)' }}>{entry.market === 'US' ? 'US' : 'Canada'}</span>
      </div>
      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{entry.name}</p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{entry.summary}</p>

      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)' }}
      >
        {open ? 'Show less' : 'Who files, deadline, what to look for'} {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div>
          <Field label="Who files">{entry.whoFiles}</Field>
          <Field label="Deadline">{entry.deadline}</Field>
          <Field label="Why it matters">{entry.whyItMatters}</Field>
          {entry.lookFor && (
            <Field label="What to look for">
              <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                {entry.lookFor.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Field>
          )}
          <Field label="In TARS">{entry.tarsNote}</Field>
        </div>
      )}
    </div>
  );
}

function ReferenceTable({ title, intro, firstHeader, rows }: {
  title: string;
  intro: string;
  firstHeader: string;
  rows: { code: string; meaning: string; weight: Weight; note: string }[];
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 760 }}>{intro}</p>
      <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14 }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ padding: '10px 12px', width: 70 }}>{firstHeader}</th>
              <th style={{ padding: '10px 12px' }}>What it means</th>
              <th style={{ padding: '10px 12px', width: 90 }}>Signal</th>
              <th style={{ padding: '10px 12px' }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} style={{ borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Roboto Mono, monospace' }}>{row.code}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{row.meaning}</td>
                <td style={{ padding: '10px 12px' }}><WeightBadge weight={row.weight} /></td>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function GlossaryPage() {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [coverage, setCoverage] = useState<CoverageFilter>('all');
  const [market, setMarket] = useState<MarketFilter>('all');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // Deep links from the Filings feed (e.g. /glossary#form-4) open and scroll to the entry.
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (!id) return;
    setQuery('');
    setCoverage('all');
    setMarket('all');
    setOpenIds((prev) => new Set(prev).add(id));
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GLOSSARY.filter((e) => {
      if (coverage !== 'all' && e.coverage !== coverage) return false;
      if (market !== 'all' && e.market !== market) return false;
      if (!q) return true;
      return [e.form, e.name, e.summary, e.whyItMatters, e.whoFiles].some((text) => text.toLowerCase().includes(q));
    });
  }, [query, coverage, market]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-agent-section="glossary-page" className="px-3 sm:px-4 md:px-8 pt-4 md:pt-8 pb-10" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <BookOpen size={18} style={{ color: 'var(--accent-blue-light)' }} />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Filing glossary</h1>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 760 }}>
        What each filing is, who files it, how fast, and what to look for. Each entry says whether TARS scores it, only shows it,
        or does not read it yet. TARS reads US SEC filings and Canadian SEDI insider trades; the Canadian equivalents of the 13D and 8-K
        (early warning and material change reports) are not covered yet.
      </p>

      <div data-agent-section="glossary-priority" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>How the 0-100 priority reads</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRIORITY_TIERS.map((t) => (
            <div key={t.tier} className="flex items-start gap-2" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ minWidth: 92, fontWeight: 800, color: t.color }}>{t.tier} {t.range}</span>
              <span>{t.meaning}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search forms, e.g. 13D, insider, bankruptcy"
          aria-label="Search the glossary"
          style={{ flex: '1 1 240px', maxWidth: 360, padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 16 }}>
        <Chip active={coverage === 'all'} onClick={() => setCoverage('all')}>All filings</Chip>
        {(Object.keys(COVERAGE_META) as Coverage[]).map((c) => (
          <Chip key={c} active={coverage === c} onClick={() => setCoverage(c)}>{COVERAGE_META[c].label}</Chip>
        ))}
        <span style={{ width: 8 }} />
        <Chip active={market === 'all'} onClick={() => setMarket('all')}>US + Canada</Chip>
        <Chip active={market === 'US'} onClick={() => setMarket('US')}>US</Chip>
        <Chip active={market === 'CA'} onClick={() => setMarket('CA')}>Canada</Chip>
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No filings match that search.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} open={openIds.has(entry.id)} onToggle={() => toggle(entry.id)} />
          ))}
        </div>
      )}

      <ReferenceTable
        title="8-K item codes"
        intro="Every 8-K lists one or more numbered items. The number tells you what kind of event it is before you read a word. 'Signal' is how often that item moves a stock, not a prediction."
        firstHeader="Item"
        rows={EIGHT_K_ITEMS}
      />
      <ReferenceTable
        title="Form 4 transaction codes"
        intro="Each line of a Form 4 carries a one-letter code. Only P and S are real market decisions; most of the rest are compensation or tax mechanics."
        firstHeader="Code"
        rows={FORM_4_CODES}
      />
    </div>
  );
}
