import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { MarketFiling } from '../../api/edgar';

interface FilingSheetProps {
  filing: MarketFiling | null;
  onClose: () => void;
}

const FORM_INFO: Record<string, { label: string; color: string; bg: string; border: string; description: string }> = {
  '13D':   { label: '13D',   color: '#F7931A', bg: 'rgba(247,147,26,0.12)', border: 'rgba(247,147,26,0.3)',  description: 'Activist investor — 5%+ ownership stake with intent to influence the company' },
  '13D/A': { label: '13D/A', color: '#F7931A', bg: 'rgba(247,147,26,0.12)', border: 'rgba(247,147,26,0.3)',  description: 'Amendment to activist 13D — stake or intent has changed' },
  '13G':   { label: '13G',   color: '#2D6BFF', bg: 'rgba(45,107,255,0.12)', border: 'rgba(45,107,255,0.3)',  description: 'Passive investor — 5%+ ownership stake, no intent to control' },
  '13G/A': { label: '13G/A', color: '#2D6BFF', bg: 'rgba(45,107,255,0.12)', border: 'rgba(45,107,255,0.3)',  description: 'Amendment to passive 13G — position size has changed' },
};

export function FilingSheet({ filing, onClose }: FilingSheetProps) {
  useEffect(() => {
    if (!filing) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filing, onClose]);

  if (!filing) return null;

  const info = FORM_INFO[filing.formType] ?? FORM_INFO['13G'];
  const is13D = filing.formType.startsWith('13D');

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
          maxHeight: '80vh',
          overflowY: 'auto',
          animation: 'slideUp 200ms ease-out',
        }}
      >
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

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
