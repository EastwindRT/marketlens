import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Briefcase, Sparkles, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { finnhub } from '../api/finnhub';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FundResult { cik: string; name: string; lastFiled: string }

interface Holding {
  name: string;
  cusip: string;
  value: number;          // full dollars
  shares: number;
  shareType: string;
  putCall: string | null; // 'Put' | 'Call' | null
  sector: string;
  isNew: boolean;
  pctOfPortfolio: number;
}

interface HoldingsMeta {
  filingDate: string;
  period: string;
  totalValue: number;
  positionCount: number;
}

interface HoldingsResponse {
  fund: string;
  meta: HoldingsMeta;
  current: Holding[];
  previous: { name: string; cusip: string; shares: number; value: number }[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtShares(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

const SECTOR_COLORS: Record<string, string> = {
  Technology:     '#1652F0',
  Consumer:       '#F7931A',
  Healthcare:     '#05B169',
  Financials:     '#8B5CF6',
  Energy:         '#EF4444',
  Industrials:    '#06B6D4',
  Communications: '#EC4899',
  Utilities:      '#84CC16',
  'Real Estate':  '#D97706',
  Materials:      '#10B981',
  Other:          '#6B7280',
};

// ── Markdown renderer (safe — no dangerouslySetInnerHTML) ─────────────────────
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^Bottom line:\s*/gim, '<strong>Bottom line:</strong> ')
    .replace(/^•\s+/gm, '<span style="display:inline-block;margin-left:4px">•</span> ')
    .replace(/\n/g, '<br/>');
}

// ── Sector bar chart ──────────────────────────────────────────────────────────
function SectorBreakdown({ holdings }: { holdings: Holding[] }) {
  const map: Record<string, number> = {};
  for (const h of holdings) {
    if (!h.putCall) map[h.sector] = (map[h.sector] || 0) + h.value;
  }
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
        Sector Breakdown (long only)
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map(([sector, val]) => {
          const pct = total > 0 ? (val / total) * 100 : 0;
          const color = SECTOR_COLORS[sector] || SECTOR_COLORS.Other;
          return (
            <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 100, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>
                {sector}
              </span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 400ms ease' }} />
              </div>
              <span style={{ width: 44, fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", flexShrink: 0 }}>
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AI chat widget ────────────────────────────────────────────────────────────
function FundAIChat({ fund, holdings, meta }: { fund: string; holdings: Holding[]; meta: HoldingsMeta }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ask-fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, fund, holdings, meta }),
      });
      const json = await res.json();
      setMessages(m => [...m, { role: 'ai', text: json.answer || json.error || 'No response' }]);
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Connection error.' }]);
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    'What is the investment thesis?',
    'What are the biggest risks?',
    'Any new positions worth watching?',
    'How concentrated is this portfolio?',
  ];

  return (
    <div style={{ marginTop: 32, borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <Sparkles size={13} color="var(--accent-blue-light)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Ask AI about this fund
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>· Llama 3.3 70B</span>
      </div>

      {/* Messages */}
      <div style={{ padding: '16px', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(s => (
              <button key={s} onClick={() => { setInput(s); }}
                style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', transition: 'border-color 150ms' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-blue)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              >{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user' ? 'var(--accent-blue)' : 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6,
              border: m.role === 'ai' ? '1px solid var(--border-subtle)' : 'none',
            }}>
              {m.role === 'ai'
                ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                : m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 6, padding: '10px 14px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-tertiary)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about holdings, strategy, risks…"
          style={{ flex: 1, padding: '10px 14px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{ width: 42, height: 42, borderRadius: 12, background: input.trim() ? 'var(--accent-blue)' : 'var(--bg-elevated)', border: '1px solid var(--border-default)', cursor: input.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 150ms' }}
        >
          <Send size={16} color={input.trim() ? '#fff' : 'var(--text-tertiary)'} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FundsPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedFund, setSelectedFund] = useState<FundResult | null>(null);
  const [tab, setTab] = useState<'all' | 'long' | 'options' | 'new'>('all');
  const [navigatingIdx, setNavigatingIdx] = useState<number | null>(null);
  const navigate = useNavigate();

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['13f-search', debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/13f/search?q=${encodeURIComponent(debouncedQuery)}`);
      return res.json() as Promise<{ funds: FundResult[] }>;
    },
    enabled: debouncedQuery.length >= 2 && !selectedFund,
    staleTime: 10 * 60 * 1000,
  });

  const { data: holdingsData, isLoading: holdingsLoading, error: holdingsError } = useQuery({
    queryKey: ['13f-holdings', selectedFund?.cik],
    queryFn: async () => {
      const res = await fetch(`/api/13f/holdings?cik=${selectedFund!.cik}`);
      return res.json() as Promise<HoldingsResponse>;
    },
    enabled: !!selectedFund,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const filtered = useMemo<Holding[]>(() => {
    const all = holdingsData?.current ?? [];
    if (tab === 'long')    return all.filter(h => !h.putCall);
    if (tab === 'options') return all.filter(h => !!h.putCall);
    if (tab === 'new')     return all.filter(h => h.isNew);
    return all;
  }, [holdingsData, tab]);

  const newCount     = (holdingsData?.current ?? []).filter(h => h.isNew).length;
  const optionsCount = (holdingsData?.current ?? []).filter(h => !!h.putCall).length;
  const longCount    = (holdingsData?.current ?? []).filter(h => !h.putCall).length;

  async function navigateToStock(holding: Holding, idx: number) {
    setNavigatingIdx(idx);
    try {
      // Try Finnhub search by company name (strip common suffixes)
      const clean = holding.name.replace(/\b(INC|CORP|LTD|LLC|PLC|CO|GROUP|HOLDINGS?|CLASS [AB])\b\.?/gi, '').trim();
      const result = await finnhub.search(clean);
      const match = result?.result?.find((r: { type: string; symbol: string }) => r.type === 'Common Stock' && !r.symbol.includes('.'));
      if (match?.symbol) {
        navigate(`/stock/${match.symbol}`);
      } else {
        navigate(`/search?q=${encodeURIComponent(clean)}`);
      }
    } catch {
      navigate(`/search?q=${encodeURIComponent(holding.name)}`);
    } finally {
      setNavigatingIdx(null);
    }
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 80px' }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Briefcase size={20} color="var(--accent-blue-light)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em' }}>
              13F Fund Holdings
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Search any institutional fund · SEC EDGAR 13F-HR filings · latest positions
          </p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: selectedFund ? 0 : 8 }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); if (selectedFund) setSelectedFund(null); }}
            placeholder="Search fund name (Berkshire, Bridgewater, Citadel…)"
            style={{
              width: '100%', padding: '12px 14px 12px 38px', borderRadius: 12, boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              color: 'var(--text-primary)', fontSize: 14, outline: 'none',
              fontFamily: "'Inter', sans-serif",
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
          />
          {searching && (
            <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid var(--accent-blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
          )}
        </div>

        {/* Search results dropdown */}
        {!selectedFund && debouncedQuery.length >= 2 && (searchData?.funds ?? []).length > 0 && (
          <div style={{ marginBottom: 24, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
            {(searchData?.funds ?? []).map((f, i) => (
              <button
                key={f.cik}
                onClick={() => { setSelectedFund(f); setQuery(f.name); }}
                style={{
                  width: '100%', padding: '12px 16px', textAlign: 'left', cursor: 'pointer',
                  background: 'transparent', border: 'none',
                  borderBottom: i < (searchData!.funds.length - 1) ? '1px solid var(--border-subtle)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'background 100ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{f.name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>CIK {f.cik}</p>
                </div>
                {f.lastFiled && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, marginLeft: 16 }}>
                    Last filed {f.lastFiled}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {!selectedFund && debouncedQuery.length >= 2 && !searching && (searchData?.funds ?? []).length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '20px 0' }}>No 13F filers found matching "{debouncedQuery}"</p>
        )}

        {/* Holdings view */}
        {selectedFund && (
          <>
            {holdingsLoading && (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <div style={{ width: 24, height: 24, border: '2px solid var(--accent-blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Loading 13F filing from SEC EDGAR…</p>
              </div>
            )}

            {holdingsError && (
              <p style={{ color: '#F6465D', fontSize: 13, padding: '24px 0' }}>
                Failed to load holdings — EDGAR may be temporarily unavailable.
              </p>
            )}

            {!holdingsLoading && holdingsData && (
              <>
                {/* Fund meta */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, margin: '20px 0 24px' }}>
                  {[
                    { label: 'Total Value',  value: fmt(holdingsData.meta.totalValue) },
                    { label: 'Positions',    value: holdingsData.meta.positionCount.toLocaleString() },
                    { label: 'Long Stocks',  value: longCount.toLocaleString() },
                    { label: 'Options',      value: optionsCount.toLocaleString() },
                    { label: 'New Positions',value: newCount.toLocaleString() },
                    { label: 'Period',       value: holdingsData.meta.period || '—' },
                  ].map(c => (
                    <div key={c.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                      <p style={{ margin: '0 0 2px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{c.label}</p>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Sector chart */}
                <SectorBreakdown holdings={holdingsData.current} />

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {([
                    { key: 'all',     label: `All (${holdingsData.current.length})` },
                    { key: 'long',    label: `Long (${longCount})` },
                    { key: 'options', label: `Options (${optionsCount})` },
                    { key: 'new',     label: `New (${newCount})` },
                  ] as const).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      style={{
                        padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: tab === t.key ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                        color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                        border: `1px solid ${tab === t.key ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                        transition: 'all 120ms',
                      }}
                    >{t.label}</button>
                  ))}
                </div>

                {/* Holdings table */}
                <div style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', marginBottom: 8 }}>
                  {/* Table header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '32px 1fr 80px 90px 80px 60px',
                    padding: '9px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    {['#', 'Company', 'Value', 'Shares', '% Port', 'Type'].map(h => (
                      <span key={h} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                    ))}
                  </div>

                  {filtered.length === 0 && (
                    <div style={{ padding: '32px', textAlign: 'center' }}>
                      <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No positions in this category</p>
                    </div>
                  )}

                  {filtered.slice(0, 100).map((h, i) => {
                    const sectorColor = SECTOR_COLORS[h.sector] || SECTOR_COLORS.Other;
                    const isNavigating = navigatingIdx === i;
                    return (
                      <div
                        key={`${h.cusip}-${i}`}
                        onClick={() => navigateToStock(h, i)}
                        style={{
                          display: 'grid', gridTemplateColumns: '32px 1fr 80px 90px 80px 60px',
                          padding: '10px 14px', cursor: 'pointer',
                          borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                          background: h.isNew ? 'rgba(5,177,105,0.03)' : 'transparent',
                          transition: 'background 100ms',
                          alignItems: 'center',
                          opacity: isNavigating ? 0.6 : 1,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = h.isNew ? 'rgba(5,177,105,0.03)' : 'transparent')}
                      >
                        {/* Rank */}
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {i + 1}
                        </span>

                        {/* Company name */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {h.name}
                            </span>
                            {h.isNew && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(5,177,105,0.15)', color: '#05B169', border: '1px solid rgba(5,177,105,0.3)', flexShrink: 0 }}>NEW</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: sectorColor, flexShrink: 0 }} />
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{h.sector}</span>
                          </div>
                        </div>

                        {/* Value */}
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {fmt(h.value)}
                        </span>

                        {/* Shares */}
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
                          {fmtShares(h.shares)}
                        </span>

                        {/* % of portfolio */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 28, height: 4, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(h.pctOfPortfolio * 4, 100)}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
                            {h.pctOfPortfolio.toFixed(1)}%
                          </span>
                        </div>

                        {/* Type badge */}
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                          background: h.putCall === 'Put' ? 'rgba(246,70,93,0.12)' : h.putCall === 'Call' ? 'rgba(5,177,105,0.12)' : 'var(--bg-hover)',
                          color: h.putCall === 'Put' ? '#F6465D' : h.putCall === 'Call' ? '#05B169' : 'var(--text-tertiary)',
                          border: `1px solid ${h.putCall === 'Put' ? 'rgba(246,70,93,0.25)' : h.putCall === 'Call' ? 'rgba(5,177,105,0.25)' : 'var(--border-subtle)'}`,
                          fontFamily: "'Roboto Mono', monospace",
                          whiteSpace: 'nowrap',
                        }}>
                          {h.putCall || 'Long'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {filtered.length > 100 && (
                  <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                    Showing top 100 of {filtered.length} positions
                  </p>
                )}

                {/* AI Chat */}
                <FundAIChat fund={holdingsData.fund} holdings={holdingsData.current} meta={holdingsData.meta} />
              </>
            )}
          </>
        )}

        {/* Empty state */}
        {!selectedFund && !debouncedQuery && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Briefcase size={32} color="var(--text-tertiary)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>Search any institutional fund</p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 12, margin: 0 }}>
              Berkshire Hathaway · Bridgewater · Citadel · Pershing Square · Renaissance · Tiger Global
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
