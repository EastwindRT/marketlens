import { useEffect, useState } from 'react';
import { X, Sparkles, RotateCcw, Copy, Check } from 'lucide-react';
import type { MarketFiling } from '../../api/edgar';
import type { NewsItem } from '../../api/types';

// ── Minimal markdown renderer ──────────────────────────────────────────────
// Supports: ## headers, bullet lists, **bold**, *italic*, _italic_, paragraphs.
// No HTML injection — we escape first, then apply a small set of allowed tags.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  let t = escapeHtml(text);
  // Bold **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic _x_ (underscore)
  t = t.replace(/(^|[\s(])_([^_]+)_([\s).,;:!?]|$)/g, '$1<em>$2</em>$3');
  // Italic *x* (asterisk, single)
  t = t.replace(/(^|[\s(])\*([^*]+)\*([\s).,;:!?]|$)/g, '$1<em>$2</em>$3');
  // Inline code `x`
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // H2
    if (trimmed.startsWith('## ')) {
      out.push(`<h2>${renderInline(trimmed.slice(3))}</h2>`);
      i++;
      continue;
    }
    // H3
    if (trimmed.startsWith('### ')) {
      out.push(`<h3>${renderInline(trimmed.slice(4))}</h3>`);
      i++;
      continue;
    }
    // H1 (treat like h2 visually)
    if (trimmed.startsWith('# ')) {
      out.push(`<h2>${renderInline(trimmed.slice(2))}</h2>`);
      i++;
      continue;
    }

    // Bullet list (- or *)
    if (/^[-*]\s+/.test(trimmed)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const item = lines[i].trim().replace(/^[-*]\s+/, '');
        out.push(`<li>${renderInline(item)}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const item = lines[i].trim().replace(/^\d+\.\s+/, '');
        out.push(`<li>${renderInline(item)}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }

    // Paragraph (collect consecutive non-blank, non-header, non-list lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      const lt = l.trim();
      if (!lt) break;
      if (lt.startsWith('## ') || lt.startsWith('### ') || lt.startsWith('# ')) break;
      if (/^[-*]\s+/.test(lt) || /^\d+\.\s+/.test(lt)) break;
      paraLines.push(lt);
      i++;
    }
    if (paraLines.length) {
      out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
    }
  }

  return out.join('\n');
}

// ── Props ──────────────────────────────────────────────────────────────────

export type DeepAnalyzeTarget =
  | { type: 'stock'; symbol: string; context: Record<string, unknown>; focus?: string }
  | { type: 'filing'; filing: MarketFiling }
  | { type: 'news'; symbol?: string; news: NewsItem };

interface Props {
  open: boolean;
  onClose: () => void;
  target: DeepAnalyzeTarget | null;
}

function getDeepAnalyzeTitle(target: DeepAnalyzeTarget): string {
  if (target.type === 'stock') {
    return target.focus ? `${target.symbol} - ${target.focus}` : `${target.symbol} - Deep Dive`;
  }
  if (target.type === 'filing') {
    const f = target.filing;
    return f.subjectCompany ? `${f.formType} · ${f.subjectCompany}` : `${f.formType} · ${f.filerName}`;
  }
  return target.news.headline;
}

function getDeepAnalyzeSubtitle(target: DeepAnalyzeTarget): string {
  if (target.type === 'stock') {
    if (target.focus) {
      return `Focused Claude briefing: ${target.focus.toLowerCase()} using live technical, ownership, and news context`;
    }
    return 'Live technical, fundamental, insider, and news read';
  }
  if (target.type === 'filing') {
    const f = target.filing;
    return [f.filerName, f.filedDate].filter(Boolean).join(' · ');
  }
  const n = target.news;
  const date = n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : '';
  return [n.source, date].filter(Boolean).join(' · ');
}

export function DeepAnalyzeDrawer({ open, onClose, target }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [profile, setProfile] = useState<'full' | 'preset' | null>(null);
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset state when drawer opens with a new target or closes
  useEffect(() => {
    if (!open) return;
    setAnalysis(null);
    setError(null);
    setLoading(false);
    setCached(false);
    setModel(null);
    setProfile(null);
  }, [open, targetKey(target)]);

  async function run() {
    if (!target) return;
    setError(null);
    setLoading(true);
    try {
      const body =
        target.type === 'stock'  ? { type: 'stock',  symbol: target.symbol, context: target.context, focus: target.focus } :
        target.type === 'filing' ? { type: 'filing', filing: target.filing } :
                                   { type: 'news',   symbol: target.symbol, news: target.news };

      const res = await fetch('/api/deep-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
      setAnalysis(json.analysis as string);
      setCached(Boolean(json.cached));
      setModel(typeof json.model === 'string' ? json.model : null);
      setProfile(json.profile === 'preset' || json.profile === 'full' ? json.profile : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('ANTHROPIC_API_KEY')) {
        setError('Deep Analyze is ready, but the Anthropic key is not configured on Render yet. Add ANTHROPIC_API_KEY to start Claude responses.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent fail — clipboard may be blocked
    }
  }

  if (!open || !target) return null;

  const title = getDeepAnalyzeTitle(target);
  const subtitle = getDeepAnalyzeSubtitle(target);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-default)',
          borderRadius: '20px 20px 0 0',
          padding: '20px 20px 36px',
          maxHeight: '90vh',
          overflowY: 'auto',
          animation: 'slideUp 200ms ease-out',
        }}
      >
        <style>{`
          @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @keyframes spin    { to   { transform: rotate(360deg); } }
          .deep-md h2 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 20px 0 8px; letter-spacing: -0.01em; }
          .deep-md h2:first-child { margin-top: 0; }
          .deep-md h3 { font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 16px 0 6px; }
          .deep-md p  { font-size: 13.5px; color: var(--text-secondary); line-height: 1.6; margin: 0 0 10px; }
          .deep-md ul, .deep-md ol { padding-left: 18px; margin: 0 0 12px; }
          .deep-md li { font-size: 13.5px; color: var(--text-secondary); line-height: 1.55; margin: 0 0 5px; }
          .deep-md strong { color: var(--text-primary); font-weight: 700; }
          .deep-md em { color: var(--text-tertiary); font-style: italic; }
          .deep-md code {
            font-family: 'Roboto Mono', monospace; font-size: 12px;
            background: var(--bg-elevated); padding: 1px 5px; border-radius: 4px;
            color: var(--text-primary);
          }
        `}</style>

        {/* Handle */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)', margin: '0 auto' }} />
          <button
            onClick={onClose}
            style={{
              position: 'absolute', right: -4, top: -6,
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Sparkles size={13} color="#D97757" />
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#D97757', textTransform: 'uppercase', letterSpacing: '0.08em',
              fontFamily: "'Inter', sans-serif",
            }}>
              Deep Analyze · Claude
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {title}
          </h2>
          {subtitle && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {subtitle}
            </p>
          )}
        </div>

        {/* Action area */}
        {!analysis && !loading && !error && (
          <button
            onClick={run}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '13px 16px', borderRadius: 12, marginBottom: 14,
              background: 'linear-gradient(135deg, rgba(217,119,87,0.12), rgba(217,119,87,0.04))',
              border: '1px solid rgba(217,119,87,0.35)',
              color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              transition: 'border-color 150ms, background 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(217,119,87,0.6)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(217,119,87,0.35)'; }}
          >
            <Sparkles size={15} color="#D97757" />
            Run Deep Analysis
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
              · {target.type === 'stock' && target.focus ? 'Cheaper preset mode' : 'Full deep dive'}
            </span>
          </button>
        )}

        {loading && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px',
            borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            marginBottom: 14,
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              border: '2px solid var(--border-default)',
              borderTopColor: '#D97757',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                Claude is analyzing…
              </p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
                {target.type === 'stock' && target.focus
                  ? 'Preset analysis on the lower-cost Claude path · usually faster'
                  : 'Full deep dive on the premium Claude path · this may take 20-40 seconds'}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, marginBottom: 14,
            background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.3)',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#F6465D', textTransform: 'uppercase' }}>
              Analysis Failed
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>{error}</p>
            <button
              onClick={() => { setError(null); run(); }}
              style={{
                fontSize: 12, color: '#F6465D', background: 'none',
                border: '1px solid rgba(246,70,93,0.4)', borderRadius: 6,
                padding: '5px 12px', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {analysis && (
          <>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {cached && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 5,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  Cached
                </span>
              )}
              {model && (
                <span style={{
                  fontSize: 10, color: 'var(--text-tertiary)',
                  fontFamily: "'Roboto Mono', monospace",
                }}>
                  {model}
                </span>
              )}
              {profile && (
                <span style={{
                  fontSize: 10, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {profile === 'preset' ? 'Preset' : 'Full'}
                </span>
              )}
              <button
                onClick={copyToClipboard}
                title="Copy to clipboard"
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: '1px solid var(--border-subtle)',
                  borderRadius: 6, padding: '4px 9px', cursor: 'pointer',
                  fontSize: 11, color: 'var(--text-secondary)',
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => { setAnalysis(null); run(); }}
                title="Re-run analysis"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: '1px solid var(--border-subtle)',
                  borderRadius: 6, padding: '4px 9px', cursor: 'pointer',
                  fontSize: 11, color: 'var(--text-secondary)',
                }}
              >
                <RotateCcw size={11} />
                Re-run
              </button>
            </div>

            {/* Rendered analysis */}
            <div
              className="deep-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }}
            />
          </>
        )}
      </div>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function targetKey(target: DeepAnalyzeTarget | null): string {
  if (!target) return '';
  if (target.type === 'stock') return `stock:${target.symbol}:${target.focus || 'full'}`;
  if (target.type === 'filing') return `filing:${target.filing.accessionNo || target.filing.edgarUrl}`;
  return `news:${target.news.id || target.news.url}`;
}

function getTitle(target: DeepAnalyzeTarget): string {
  if (target.type === 'stock')  return `${target.symbol} — Deep Dive`;
  if (target.type === 'filing') {
    const f = target.filing;
    return f.subjectCompany
      ? `${f.formType} · ${f.subjectCompany}`
      : `${f.formType} · ${f.filerName}`;
  }
  return target.news.headline;
}

function getSubtitle(target: DeepAnalyzeTarget): string {
  if (target.type === 'stock') return 'Live technical, fundamental, insider, and news read';
  if (target.type === 'filing') {
    const f = target.filing;
    return [f.filerName, f.filedDate].filter(Boolean).join(' · ');
  }
  const n = target.news;
  const date = n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : '';
  return [n.source, date].filter(Boolean).join(' · ');
}
