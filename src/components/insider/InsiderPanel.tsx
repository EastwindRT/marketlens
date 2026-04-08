import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Sparkles, TrendingUp, TrendingDown, Minus, AlertTriangle, RotateCcw } from 'lucide-react';
import type { InsiderTransaction, OHLCVBar } from '../../api/types';
import type { InsiderFilter } from '../../api/types';
import { InsiderRow, INSIDER_GRID, INSIDER_GRID_MOBILE } from './InsiderRow';
import { InsiderRowSkeleton } from '../ui/LoadingSkeleton';
import { getInsiderType, SEC_CODE_LABELS, SEDI_CODE_LABELS } from '../../hooks/useInsiderData';

interface InsiderPanelProps {
  symbol?: string;
  transactions: InsiderTransaction[];
  candles?: OHLCVBar[];
  loading?: boolean;
  error?: Error | null;
  currency?: 'USD' | 'CAD';
  isCanadian?: boolean;
  onRowClick?: (transaction: InsiderTransaction) => void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface InsiderAnalysis {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  sentimentSummary: string;
  pattern: string;
  topInsiders: string[];
  netBuyValue: string;
  buyCount: number;
  sellCount: number;
  thesis: string;
  catalysts: string[];
  risks: string[];
  keyTrade: string;
}

// ─── AI Analysis Card ─────────────────────────────────────────────────────────

function InsiderAICard({
  symbol,
  transactions,
  onClose,
}: {
  symbol: string;
  transactions: InsiderTransaction[];
  onClose: () => void;
}) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<InsiderAnalysis | null>(null);

  async function runAnalysis() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/analyze-insiders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, trades: transactions }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
      setAnalysis(json.analysis as InsiderAnalysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  // Auto-run on mount
  useEffect(() => { runAnalysis(); }, []);

  const signalColor = (s?: string) =>
    s === 'BULLISH' ? '#05B169' :
    s === 'BEARISH' ? '#F6465D' :
    s === 'MIXED'   ? '#F7931A' : '#8A8F98';

  const signalBg = (s?: string) =>
    s === 'BULLISH' ? 'rgba(5,177,105,0.1)' :
    s === 'BEARISH' ? 'rgba(246,70,93,0.1)' :
    s === 'MIXED'   ? 'rgba(247,147,26,0.1)' : 'rgba(138,143,152,0.1)';

  const convictionColor = (c?: string) =>
    c === 'HIGH' ? '#05B169' : c === 'MEDIUM' ? '#F7931A' : '#8A8F98';

  const SignalIcon = ({ s }: { s?: string }) =>
    s === 'BULLISH' ? <TrendingUp size={14} color={signalColor(s)} /> :
    s === 'BEARISH' ? <TrendingDown size={14} color={signalColor(s)} /> :
    <Minus size={14} color={signalColor(s)} />;

  return (
    <div style={{
      margin: '0 0 0 0',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--bg-elevated)',
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={14} color="var(--accent-blue-light)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Quant Insider Analysis
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
            · Llama 3.3 70B
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[90, 65, 80, 50].map((w, i) => (
            <div key={i} className="animate-pulse" style={{
              height: 12, borderRadius: 6, background: 'var(--bg-hover)', width: `${w}%`,
            }} />
          ))}
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
            Analysing {transactions.length} insider transactions…
          </p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} color="#F6465D" />
            <span style={{ fontSize: 13, color: '#F6465D' }}>{error}</span>
          </div>
          <button
            onClick={runAnalysis}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--bg-hover)', border: '1px solid var(--border-default)',
              color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
            }}
          >
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Analysis Result */}
      {!loading && !error && analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Signal row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 10,
              background: signalBg(analysis.signal),
              border: `1px solid ${signalColor(analysis.signal)}33`,
            }}>
              <SignalIcon s={analysis.signal} />
              <span style={{ fontSize: 15, fontWeight: 800, color: signalColor(analysis.signal), letterSpacing: '0.02em' }}>
                {analysis.signal}
              </span>
            </div>
            <div style={{
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--bg-hover)', border: '1px solid var(--border-default)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 6 }}>Conviction</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: convictionColor(analysis.conviction) }}>
                {analysis.conviction}
              </span>
            </div>
            <div style={{
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--bg-hover)', border: '1px solid var(--border-default)',
            }}>
              <span style={{ fontSize: 11, color: '#05B169', marginRight: 4 }}>▲ {analysis.buyCount ?? 0}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '0 4px' }}>·</span>
              <span style={{ fontSize: 11, color: '#F6465D', marginLeft: 4 }}>▼ {analysis.sellCount ?? 0}</span>
            </div>
          </div>

          {/* Sentiment summary */}
          {analysis.sentimentSummary && (
            <p style={{
              fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
              lineHeight: 1.5, margin: 0,
              padding: '12px 14px', borderRadius: 10,
              background: 'var(--bg-hover)', borderLeft: `3px solid ${signalColor(analysis.signal)}`,
            }}>
              {analysis.sentimentSummary}
            </p>
          )}

          {/* Pattern badge */}
          {analysis.pattern && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', paddingTop: 2, flexShrink: 0 }}>
                Pattern
              </span>
              <span style={{
                fontSize: 12, color: 'var(--text-secondary)',
                padding: '3px 10px', borderRadius: 6,
                background: 'rgba(45,107,255,0.08)', border: '1px solid rgba(45,107,255,0.2)',
              }}>
                {analysis.pattern}
              </span>
            </div>
          )}

          {/* Net flow */}
          {analysis.netBuyValue && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
                Net Flow
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: signalColor(analysis.signal), fontFamily: "'Roboto Mono', monospace" }}>
                {analysis.netBuyValue}
              </span>
            </div>
          )}

          {/* Key insiders */}
          {analysis.topInsiders && analysis.topInsiders.length > 0 && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                Key Insiders
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {analysis.topInsiders.slice(0, 4).map((ins, i) => (
                  <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 8, borderLeft: '2px solid var(--border-default)' }}>
                    {ins}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Thesis */}
          {analysis.thesis && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                Thesis
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {analysis.thesis}
              </p>
            </div>
          )}

          {/* Key Trade */}
          {analysis.keyTrade && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(45,107,255,0.06)', border: '1px solid rgba(45,107,255,0.15)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-blue-light)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>
                Key Trade
              </span>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {analysis.keyTrade}
              </p>
            </div>
          )}

          {/* Catalysts + Risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {analysis.catalysts && analysis.catalysts.length > 0 && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#05B169', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                  Catalysts
                </p>
                <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {analysis.catalysts.map((c, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.risks && analysis.risks.length > 0 && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#F6465D', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                  Risks
                </p>
                <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {analysis.risks.map((r, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export function InsiderPanel({
  symbol,
  transactions,
  candles = [],
  loading,
  error,
  currency = 'USD',
  isCanadian = false,
  onRowClick,
}: InsiderPanelProps) {
  const [filter, setFilter]     = useState<InsiderFilter>('all');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');
  const [showAI, setShowAI]     = useState(false);

  const filtered = transactions
    .filter(t => {
      if (filter === 'all') return true;
      const type = getInsiderType(t.transactionCode, t.change);
      return filter === 'buy' ? type === 'BUY' : type === 'SELL';
    })
    .sort((a, b) => {
      const diff = new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime();
      return sortDir === 'desc' ? -diff : diff;
    });

  const buys  = transactions.filter(t => getInsiderType(t.transactionCode, t.change) === 'BUY').length;
  const sells = transactions.filter(t => getInsiderType(t.transactionCode, t.change) === 'SELL').length;

  const hasCorrelation = candles.length > 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      {/* ── Panel Header ── */}
      <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between flex-wrap gap-4">

          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Insider Activity
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(5,177,105,0.12)', color: 'var(--color-up)' }}>
                {buys} Buys
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(246,70,93,0.12)', color: 'var(--color-down)' }}>
                {sells} Sells
              </span>
            </div>
            {hasCorrelation && (
              <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>
                30d / 90d = price after trade
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* AI button */}
            {symbol && transactions.length > 0 && (
              <button
                onClick={() => setShowAI(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  background: showAI ? 'rgba(22,82,240,0.15)' : 'var(--bg-elevated)',
                  border: showAI ? '1px solid rgba(45,107,255,0.4)' : '1px solid var(--border-default)',
                  color: showAI ? 'var(--accent-blue-light)' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600,
                  transition: 'all 150ms',
                }}
              >
                <Sparkles size={12} />
                Ask AI
              </button>
            )}

            {/* Filter pills */}
            <div className="flex items-center rounded-xl p-1"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              {(['all', 'buy', 'sell'] as InsiderFilter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1 text-xs font-semibold rounded-lg capitalize"
                  style={{
                    background: filter === f ? 'var(--bg-hover)' : 'transparent',
                    color: filter === f
                      ? (f === 'buy' ? 'var(--color-up)' : f === 'sell' ? 'var(--color-down)' : 'var(--text-primary)')
                      : 'var(--text-tertiary)',
                    border: filter === f ? '1px solid var(--border-default)' : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 150ms ease-out',
                  }}
                >
                  {f === 'all' ? 'All' : f === 'buy' ? 'Buys' : 'Sells'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Column Headers — Mobile (4 cols) ── */}
      <div
        className="md:hidden grid gap-2 px-4 py-2.5 text-xs font-semibold"
        style={{
          gridTemplateColumns: INSIDER_GRID_MOBILE,
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 text-left"
          style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', font: 'inherit', minHeight: 44 }}
        >
          Date {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>
        <span className="self-center">Name</span>
        <span className="self-center">Type</span>
        <span className="self-center text-right">Value</span>
      </div>

      {/* ── Column Headers — Desktop (10 cols) ── */}
      <div
        className="hidden md:grid gap-2 px-6 py-2.5 text-xs font-semibold"
        style={{
          gridTemplateColumns: INSIDER_GRID,
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 text-left"
          style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', font: 'inherit' }}
        >
          Date {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>
        <span>Name</span>
        <span>Role</span>
        <span>Type</span>
        <span title="Transaction code from SEC Form 4 or SEDI">Code</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value</span>
        <span className="text-right" title="Price change 30 days after trade">30d</span>
        <span className="text-right" title="Price change 90 days after trade">90d</span>
      </div>

      {/* ── Rows ── */}
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {loading && Array.from({ length: 6 }).map((_, i) => <InsiderRowSkeleton key={i} />)}

        {error && (
          <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Failed to load insider data
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No insider transactions found</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Insider data may not be available for this ticker
            </p>
          </div>
        )}

        {!loading && !error && filtered.map((t, i) => (
          <InsiderRow
            key={i}
            transaction={t}
            candles={candles}
            currency={currency}
            isCanadian={isCanadian}
            onClick={() => onRowClick?.(t)}
          />
        ))}
      </div>

      {/* ── AI Analysis Card ── */}
      {showAI && symbol && (
        <InsiderAICard
          symbol={symbol}
          transactions={transactions}
          onClose={() => setShowAI(false)}
        />
      )}

      {/* ── Code Legend ── */}
      {!loading && transactions.length > 0 && (
        <CodeLegend transactions={transactions} isCanadian={isCanadian} />
      )}
    </div>
  );
}

// ─── Code Legend ────────────────────────────────────────────────────────────

function CodeLegend({ transactions, isCanadian }: { transactions: InsiderTransaction[]; isCanadian: boolean }) {
  const [open, setOpen] = useState(false);

  // Collect only the codes actually present in this dataset
  const presentCodes = [...new Set(transactions.map(t => t.rawCode).filter(Boolean))] as string[];
  if (presentCodes.length === 0) return null;

  const codeMap = isCanadian ? SEDI_CODE_LABELS : SEC_CODE_LABELS;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-3 text-xs"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        <span>Transaction Code Reference — {isCanadian ? 'SEDI (Canada)' : 'SEC Form 4 (US)'}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div
          className="px-6 pb-5"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <div className="flex flex-wrap gap-x-8 gap-y-2 pt-2">
            {presentCodes.map(code => (
              <div key={code} className="flex items-center gap-2 min-w-[180px]">
                <span
                  className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)',
                    fontSize: '10px',
                  }}
                >
                  {code}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {codeMap[code] || 'Other transaction'}
                </span>
              </div>
            ))}
          </div>

          {/* Show all possible codes for reference */}
          {Object.keys(codeMap).filter(c => !presentCodes.includes(c)).length > 0 && (
            <>
              <p className="text-xs mt-4 mb-2 font-semibold" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                All {isCanadian ? 'SEDI' : 'SEC'} Codes
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-1.5">
                {Object.entries(codeMap).map(([code, label]) => (
                  <div key={code} className="flex items-center gap-2 min-w-[180px]">
                    <span
                      className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: presentCodes.includes(code) ? 'rgba(22,82,240,0.15)' : 'var(--bg-surface)',
                        color: presentCodes.includes(code) ? 'var(--accent-blue-light)' : 'var(--text-tertiary)',
                        border: `1px solid ${presentCodes.includes(code) ? 'rgba(45,107,255,0.3)' : 'var(--border-subtle)'}`,
                        fontSize: '10px',
                      }}
                    >
                      {code}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
