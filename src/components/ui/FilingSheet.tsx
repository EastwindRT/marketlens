import { useEffect, useState } from 'react';
import { ExternalLink, X, Sparkles, RotateCcw } from 'lucide-react';
import type { MarketFiling } from '../../api/edgar';

// ── Types ──────────────────────────────────────────────────────────────────

interface FilingAnalysis {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WATCH';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  ownership: { currentStake: string; shareCount: string; changeFromPrior: string };
  investorType: 'Activist' | 'Passive' | 'Strategic' | 'Unknown';
  statedIntent: string;
  catalysts: string[];
  risks: string[];
  thesis: string;
  keyQuote: string;
}

// ── Visual constants ───────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<FilingAnalysis['signal'], { color: string; bg: string; border: string; label: string }> = {
  BULLISH: { color: '#05B169', bg: 'rgba(5,177,105,0.12)',   border: 'rgba(5,177,105,0.3)',   label: '▲ BULLISH' },
  BEARISH: { color: '#F6465D', bg: 'rgba(246,70,93,0.12)',   border: 'rgba(246,70,93,0.3)',   label: '▼ BEARISH' },
  NEUTRAL: { color: '#8A8F98', bg: 'rgba(138,143,152,0.12)', border: 'rgba(138,143,152,0.3)', label: '◆ NEUTRAL' },
  WATCH:   { color: '#F7931A', bg: 'rgba(247,147,26,0.12)',  border: 'rgba(247,147,26,0.3)',  label: '◉ WATCH'   },
};

const CONVICTION_COLOR: Record<FilingAnalysis['conviction'], string> = {
  HIGH:   '#05B169',
  MEDIUM: '#F7931A',
  LOW:    '#8A8F98',
};

const FORM_INFO: Record<string, { label: string; color: string; bg: string; border: string; description: string }> = {
  '13D':   { label: '13D',   color: '#F7931A', bg: 'rgba(247,147,26,0.12)', border: 'rgba(247,147,26,0.3)',  description: 'Activist investor — 5%+ ownership stake with intent to influence the company' },
  '13D/A': { label: '13D/A', color: '#F7931A', bg: 'rgba(247,147,26,0.12)', border: 'rgba(247,147,26,0.3)',  description: 'Amendment to activist 13D — stake or intent has changed' },
  '13G':   { label: '13G',   color: '#D97757', bg: 'rgba(217,119,87,0.12)', border: 'rgba(217,119,87,0.3)',  description: 'Passive investor — 5%+ ownership stake, no intent to control' },
  '13G/A': { label: '13G/A', color: '#D97757', bg: 'rgba(217,119,87,0.12)', border: 'rgba(217,119,87,0.3)',  description: 'Amendment to passive 13G — position size has changed' },
};

// ── Analysis result card ───────────────────────────────────────────────────

function AnalysisCard({ analysis, onReset }: { analysis: FilingAnalysis; onReset: () => void }) {
  const sig = SIGNAL_STYLE[analysis.signal] ?? SIGNAL_STYLE.NEUTRAL;

  return (
    <div className="fade-in" style={{ marginBottom: 14 }}>

      {/* Signal + conviction + reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
          background: sig.bg, color: sig.color, border: `1px solid ${sig.border}`,
          fontFamily: "'Roboto Mono', monospace", letterSpacing: '0.05em',
        }}>
          {sig.label}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          color: CONVICTION_COLOR[analysis.conviction],
          fontFamily: "'Roboto Mono', monospace",
        }}>
          {analysis.conviction} CONVICTION
        </span>
        <span style={{
          fontSize: 11, padding: '3px 8px', borderRadius: 6,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          color: 'var(--text-tertiary)',
        }}>
          {analysis.investorType}
        </span>
        <button
          onClick={onReset}
          title="Re-analyze"
          style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Ownership stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        {[
          { label: 'Stake',  value: analysis.ownership.currentStake },
          { label: 'Shares', value: analysis.ownership.shareCount },
          { label: 'Change', value: analysis.ownership.changeFromPrior },
        ].map(({ label, value }) => (
          <div key={label} style={{
            padding: '10px 10px 8px', borderRadius: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}>
            <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {label}
            </p>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", wordBreak: 'break-word' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Stated intent */}
      <div style={{
        padding: '11px 12px', borderRadius: 10, marginBottom: 10,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
      }}>
        <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Stated Intent
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {analysis.statedIntent}
        </p>
      </div>

      {/* Quant thesis */}
      <div style={{
        padding: '11px 12px', borderRadius: 10, marginBottom: 10,
        background: sig.bg, border: `1px solid ${sig.border}`,
      }}>
        <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 700, color: sig.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Quant Thesis
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.55 }}>
          {analysis.thesis}
        </p>
      </div>

      {/* Key quote */}
      {analysis.keyQuote && (
        <div style={{
          padding: '11px 12px', borderRadius: 10, marginBottom: 10,
          background: 'var(--bg-elevated)',
          border: `1px solid var(--border-subtle)`,
          borderLeftColor: sig.color,
          borderLeftWidth: 3,
        }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Key Quote
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
            "{analysis.keyQuote}"
          </p>
        </div>
      )}

      {/* Catalysts + Risks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Catalysts', items: analysis.catalysts, color: '#05B169', bullet: '+' },
          { label: 'Risks',     items: analysis.risks,     color: '#F6465D', bullet: '−' },
        ].map(({ label, items, color, bullet }) => (
          <div key={label} style={{
            padding: '10px 10px 8px', borderRadius: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {label}
            </p>
            {(items ?? []).map((item, i) => (
              <p key={i} style={{ margin: '0 0 3px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, display: 'flex', gap: 5 }}>
                <span style={{ color, flexShrink: 0, fontWeight: 700 }}>{bullet}</span>
                {item}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface FilingSheetProps {
  filing: MarketFiling | null;
  onClose: () => void;
}

export function FilingSheet({ filing, onClose }: FilingSheetProps) {
  useEffect(() => {
    if (!filing) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filing, onClose]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FilingAnalysis | null>(null);

  // Reset when a new filing is opened
  useEffect(() => {
    setAnalysis(null);
    setError(null);
    setLoading(false);
  }, [filing?.accessionNo]);

  if (!filing) return null;

  const info = FORM_INFO[filing.formType] ?? FORM_INFO['13G'];
  const is13D = filing.formType.startsWith('13D');

  async function runAnalysis() {
    if (!filing) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/analyze-filing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edgarUrl: filing.edgarUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
      setAnalysis(json.analysis as FilingAnalysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-default)',
          borderRadius: '20px 20px 0 0',
          padding: '20px 20px 36px',
          maxHeight: '85vh',
          overflowY: 'auto',
          animation: 'slideUp 200ms ease-out',
        }}
      >
        <style>{`
          @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @keyframes spin    { to   { transform: rotate(360deg); } }
        `}</style>

        {/* Handle + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)', margin: '0 auto' }} />
          <button
            onClick={onClose}
            style={{
              position: 'absolute', right: 16, top: 16,
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Form type badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{
            fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
            background: info.bg, color: info.color, border: `1px solid ${info.border}`,
            fontFamily: "'Roboto Mono', monospace",
          }}>
            SCHEDULE {info.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{filing.filedDate}</span>
        </div>

        {/* Subject company */}
        {filing.subjectCompany && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Target Company</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>
              {filing.subjectCompany}
            </p>
          </div>
        )}

        {/* Filer */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
            {is13D ? 'Activist Investor' : 'Passive Holder'}
          </p>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            {filing.filerName}
          </p>
        </div>

        {/* What this means */}
        <div style={{
          padding: '12px 14px', borderRadius: 10, marginBottom: 18,
          background: info.bg, border: `1px solid ${info.border}`,
        }}>
          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: info.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            What this means
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {info.description}
          </p>
          {is13D && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: info.color, fontWeight: 500 }}>
              ⚡ Activist 13D filings often signal a push for management changes, buybacks, M&A, or other value-unlocking actions.
            </p>
          )}
        </div>

        {/* Accession number */}
        {filing.accessionNo && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>SEC Filing Reference</p>
            <p style={{ margin: 0, fontSize: 12, fontFamily: "'Roboto Mono', monospace", color: 'var(--text-secondary)' }}>
              {filing.accessionNo}
            </p>
          </div>
        )}

        {/* ── AI Analysis ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>

          {/* Result card */}
          {analysis && (
            <AnalysisCard analysis={analysis} onReset={() => setAnalysis(null)} />
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: '11px 12px', borderRadius: 10, marginBottom: 10,
              background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.3)',
            }}>
              <p style={{ margin: '0 0 3px', fontSize: 11, fontWeight: 700, color: '#F6465D', textTransform: 'uppercase' }}>Analysis Failed</p>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>{error}</p>
              <button
                onClick={() => { setError(null); runAnalysis(); }}
                style={{
                  fontSize: 11, color: '#F6465D', background: 'none',
                  border: '1px solid rgba(246,70,93,0.4)', borderRadius: 6,
                  padding: '4px 10px', cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Analyze button */}
          {!analysis && !loading && (
            <button
              onClick={runAnalysis}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                width: '100%', padding: '12px 16px', borderRadius: 12, marginBottom: 10,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-blue-light)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
            >
              <Sparkles size={14} color="var(--accent-blue-light)" />
              Analyze with AI
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>· Llama 3.3 70B</span>
            </button>
          )}

          {/* Loading */}
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
              borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              marginBottom: 10,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: '2px solid var(--border-default)',
                borderTopColor: 'var(--accent-blue-light)',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Analyzing filing…</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>Fetching EDGAR document · running quant analysis</p>
              </div>
            </div>
          )}
        </div>

        {/* View on EDGAR */}
        <a
          href={filing.edgarUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 16px', borderRadius: 12, textDecoration: 'none',
            background: 'var(--accent-blue)', color: '#fff',
            fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif",
          }}
        >
          View Full Filing on SEC EDGAR <ExternalLink size={14} />
        </a>
      </div>
    </>
  );
}
