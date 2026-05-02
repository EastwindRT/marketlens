import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Briefcase, Sparkles, Send, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { finnhub } from '../api/finnhub';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FundResult { cik: string; name: string; lastFiled: string }

interface Holding {
  name: string;
  cusip: string;
  value: number;
  shares: number;
  shareType: string;
  putCall: string | null;
  sector: string;
  isNew: boolean;
  changeType: 'new' | 'increased' | 'decreased' | 'unchanged' | 'exited' | 'unknown';
  changePct: number;
  pctOfPortfolio: number;
}

interface HoldingsMeta {
  filingDate: string;
  period: string;
  totalValue: number;
  positionCount: number;
  newCount: number;
  increasedCount: number;
  decreasedCount: number;
  exitedCount: number;
}

interface HoldingsResponse {
  fund: string;
  meta: HoldingsMeta;
  current: Holding[];
  exited: Holding[];
  previous: { name: string; cusip: string; shares: number; value: number }[] | null;
}

interface FundChangeItem {
  name: string;
  cusip: string;
  value: number;
  shares: number;
  changeType: Holding['changeType'];
  changePct: number;
  putCall: string | null;
  sector: string | null;
}

interface BigFundChange {
  cik: string;
  fund: string;
  filingDate: string;
  period: string;
  totalValue: number;
  positionCount: number;
  newCount: number;
  increasedCount: number;
  decreasedCount: number;
  exitedCount: number;
  topChanged: FundChangeItem[];
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
  Technology:     '#D97757',   // Claude coral — dominant accent
  Consumer:       '#E8A87C',   // warm peach
  Healthcare:     '#4CAF82',   // muted emerald
  Financials:     '#9B7FD4',   // muted purple
  Energy:         '#C4624A',   // deep terracotta
  Industrials:    '#5BA8C4',   // steel blue
  Communications: '#C47DB5',   // dusty rose
  Utilities:      '#8DAF5A',   // olive green
  'Real Estate':  '#B8956A',   // warm tan
  Materials:      '#6BAF9B',   // sage teal
  Other:          '#7A6F65',   // warm gray
};

// ── Markdown renderer ─────────────────────────────────────────────────────────
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

// ── Change badge ──────────────────────────────────────────────────────────────
function ChangeBadge({ changeType, changePct }: { changeType: Holding['changeType']; changePct: number }) {
  if (changeType === 'new') return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'rgba(5,177,105,0.15)', color: '#05B169', border: '1px solid rgba(5,177,105,0.3)', whiteSpace: 'nowrap' }}>NEW</span>
  );
  if (changeType === 'increased') return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#05B169', fontFamily: "'Roboto Mono', monospace", whiteSpace: 'nowrap' }}>
      <TrendingUp size={10} />+{Math.abs(changePct).toFixed(0)}%
    </span>
  );
  if (changeType === 'decreased') return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#F6465D', fontFamily: "'Roboto Mono', monospace", whiteSpace: 'nowrap' }}>
      <TrendingDown size={10} />-{Math.abs(changePct).toFixed(0)}%
    </span>
  );
  if (changeType === 'unknown') return null;
  return <Minus size={10} color="var(--text-tertiary)" />;
}

// ── Sector breakdown ──────────────────────────────────────────────────────────
function SectorBreakdown({ holdings }: { holdings: Holding[] }) {
  const longOnly = holdings.filter(h => !h.putCall && h.changeType !== 'exited');
  const map: Record<string, { value: number; tops: string[] }> = {};
  for (const h of longOnly) {
    if (!map[h.sector]) map[h.sector] = { value: 0, tops: [] };
    map[h.sector].value += h.value;
    if (map[h.sector].tops.length < 3) map[h.sector].tops.push(h.name.split(' ')[0]);
  }
  const total = Object.values(map).reduce((a, b) => a + b.value, 0);
  const sorted = Object.entries(map).sort((a, b) => b[1].value - a[1].value);

  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
        Sector Breakdown · Long positions only
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(([sector, { value, tops }]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          const color = SECTOR_COLORS[sector] || SECTOR_COLORS.Other;
          return (
            <div key={sector}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                <span style={{ width: 110, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>{sector}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 400ms ease' }} />
                </div>
                <span style={{ width: 44, fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", flexShrink: 0 }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              {/* Top holdings chips */}
              <div style={{ display: 'flex', gap: 4, paddingLeft: 120 }}>
                {tops.map(t => (
                  <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: `${color}18`, color, border: `1px solid ${color}30`, fontFamily: "'Roboto Mono', monospace", fontWeight: 700 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Options section ───────────────────────────────────────────────────────────
function OptionsSection({ holdings, navigateToStock }: { holdings: Holding[]; navigateToStock: (h: Holding, i: number) => void }) {
  const [filter, setFilter] = useState<'all' | 'call' | 'put'>('all');
  const allCalls = holdings.filter(h => h.putCall?.toLowerCase() === 'call').sort((a, b) => b.value - a.value);
  const allPuts  = holdings.filter(h => h.putCall?.toLowerCase() === 'put').sort((a, b) => b.value - a.value);

  if (allCalls.length === 0 && allPuts.length === 0) {
    return <p style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No options positions in this filing</p>;
  }

  const visible = filter === 'call' ? allCalls : filter === 'put' ? allPuts : [...allCalls, ...allPuts].sort((a, b) => b.value - a.value);

  return (
    <div>
      {/* Sub-filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['all', 'call', 'put'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filter === f ? (f === 'put' ? '#F6465D' : f === 'call' ? '#05B169' : 'var(--accent-blue)') : 'var(--bg-elevated)',
            color: filter === f ? '#fff' : 'var(--text-secondary)',
            border: `1px solid ${filter === f ? 'transparent' : 'var(--border-default)'}`,
            transition: 'all 120ms', textTransform: 'uppercase',
          }}>
            {f === 'all' ? `All (${allCalls.length + allPuts.length})` : f === 'call' ? `Calls (${allCalls.length})` : `Puts (${allPuts.length})`}
          </button>
        ))}
      </div>

      {/* Unified list sorted by value */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.slice(0, 50).map((h, i) => {
          const isCall = h.putCall?.toLowerCase() === 'call';
          const color = isCall ? '#05B169' : '#F6465D';
          const bg    = isCall ? 'rgba(5,177,105,0.08)' : 'rgba(246,70,93,0.08)';
          return (
            <div key={`${h.cusip}-${i}`} onClick={() => navigateToStock(h, i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'border-color 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: bg, color, border: `1px solid ${color}30`, flexShrink: 0, fontFamily: "'Roboto Mono', monospace" }}>
                {h.putCall?.toUpperCase()}
              </span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace', flexShrink: 0" }}>{fmtShares(h.shares)} shs</span>
              <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "'Roboto Mono', monospace", flexShrink: 0, minWidth: 64, textAlign: 'right' }}>{fmt(h.value)}</span>
              {h.changeType === 'new' && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'rgba(5,177,105,0.15)', color: '#05B169', border: '1px solid rgba(5,177,105,0.3)', flexShrink: 0 }}>NEW</span>}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <Sparkles size={13} color="var(--accent-blue-light)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ask AI about this fund</span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>· Llama 3.3 70B</span>
      </div>
      <div style={{ padding: '16px', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(s => (
              <button key={s} onClick={() => setInput(s)}
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
              {m.role === 'ai' ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} /> : m.text}
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

// ── Holdings table ────────────────────────────────────────────────────────────
function HoldingsTable({ holdings, navigateToStock, navigatingIdx }: {
  holdings: Holding[];
  navigateToStock: (h: Holding, i: number) => void;
  navigatingIdx: number | null;
}) {
  if (holdings.length === 0) {
    return <div style={{ padding: '32px', textAlign: 'center' }}><p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No positions in this category</p></div>;
  }

  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 90px 90px 70px 70px', padding: '9px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        {['#', 'Company', 'Value', 'Shares', '% Port', 'Change'].map(h => (
          <span key={h} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
        ))}
      </div>

      {holdings.slice(0, 100).map((h, i) => {
        const sectorColor = SECTOR_COLORS[h.sector] || SECTOR_COLORS.Other;
        const isNavigating = navigatingIdx === i;
        return (
          <div
            key={`${h.cusip}-${i}`}
            onClick={() => navigateToStock(h, i)}
            style={{
              display: 'grid', gridTemplateColumns: '32px 1fr 90px 90px 70px 70px',
              padding: '10px 14px', cursor: 'pointer',
              borderBottom: i < Math.min(holdings.length, 100) - 1 ? '1px solid var(--border-subtle)' : 'none',
              background: h.changeType === 'new' ? 'rgba(5,177,105,0.03)' : 'transparent',
              transition: 'background 100ms', alignItems: 'center',
              opacity: isNavigating ? 0.6 : 1,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = h.changeType === 'new' ? 'rgba(5,177,105,0.03)' : 'transparent')}
          >
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>{i + 1}</span>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                {h.putCall && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: h.putCall === 'Put' ? 'rgba(246,70,93,0.12)' : 'rgba(5,177,105,0.12)', color: h.putCall === 'Put' ? '#F6465D' : '#05B169', border: `1px solid ${h.putCall === 'Put' ? 'rgba(246,70,93,0.3)' : 'rgba(5,177,105,0.3)'}`, flexShrink: 0 }}>
                    {h.putCall.toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: sectorColor, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{h.sector}</span>
              </div>
            </div>

            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
              {fmt(h.value)}
            </span>

            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
              {fmtShares(h.shares)}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 28, height: 4, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(h.pctOfPortfolio * 4, 100)}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace" }}>
                {h.pctOfPortfolio.toFixed(1)}%
              </span>
            </div>

            <ChangeBadge changeType={h.changeType} changePct={h.changePct} />
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FundsPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedFund, setSelectedFund] = useState<FundResult | null>(null);
  const [tab, setTab] = useState<'all' | 'long' | 'options' | 'new' | 'exited'>('all');
  const [navigatingIdx, setNavigatingIdx] = useState<number | null>(null);
  const [largeOnly, setLargeOnly] = useState(false);
  const navigate = useNavigate();

  const { data: bigFundChangesData } = useQuery({
    queryKey: ['13f-big-fund-changes'],
    queryFn: async () => {
      const res = await fetch('/api/13f/big-fund-changes?limit=18');
      return res.json() as Promise<{ funds: BigFundChange[]; trackedFundUniverse: number; generatedAt: string }>;
    },
    staleTime: 24 * 60 * 60 * 1000,
  });

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
    let base: Holding[];
    if (tab === 'long')    base = all.filter(h => !h.putCall);
    else if (tab === 'options') base = all.filter(h => !!h.putCall);
    else if (tab === 'new') {
      // Sort new/active by value desc so largest new bets appear first
      base = all
        .filter(h => h.changeType === 'new' || h.changeType === 'increased')
        .sort((a, b) => b.value - a.value);
    }
    else if (tab === 'exited') base = holdingsData?.exited ?? [];
    else base = all;
    return largeOnly ? base.filter(h => h.value >= 10_000_000) : base;
  }, [holdingsData, tab, largeOnly]);

  const meta = holdingsData?.meta;
  const optionsCount = (holdingsData?.current ?? []).filter(h => !!h.putCall).length;
  const longCount    = (holdingsData?.current ?? []).filter(h => !h.putCall).length;
  const activityCount = (meta?.newCount ?? 0) + (meta?.increasedCount ?? 0);

  async function navigateToStock(holding: Holding, idx: number) {
    setNavigatingIdx(idx);
    try {
      const clean = holding.name.replace(/\b(INC|CORP|LTD|LLC|PLC|CO|GROUP|HOLDINGS?|CLASS [AB])\b\.?/gi, '').trim();
      const result = await finnhub.search(clean);
      const match = result?.result?.find((r: { type: string; symbol: string }) => r.type === 'Common Stock' && !r.symbol.includes('.'));
      if (match?.symbol) navigate(`/stock/${match.symbol}`);
      else navigate(`/search?q=${encodeURIComponent(clean)}`);
    } catch {
      navigate(`/search?q=${encodeURIComponent(holding.name)}`);
    } finally {
      setNavigatingIdx(null);
    }
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 80px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Briefcase size={20} color="var(--accent-blue-light)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em' }}>
              Big Fund Filing Changes
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Track 13F changes from major managers. Search any filer for detail.
          </p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: selectedFund ? 0 : 8 }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); if (selectedFund) setSelectedFund(null); setTab('all'); }}
            placeholder="Search fund name (Berkshire, Bridgewater, Citadel…)"
            style={{
              width: '100%', padding: '12px 14px 12px 38px', borderRadius: 12, boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              color: 'var(--text-primary)', fontSize: 14, outline: 'none',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
          />
          {searching && (
            <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid var(--accent-blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
          )}
        </div>

        {/* Search results */}
        {!selectedFund && debouncedQuery.length >= 2 && (searchData?.funds ?? []).length > 0 && (
          <div style={{ marginBottom: 24, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
            {(searchData?.funds ?? []).map((f, i) => (
              <button
                key={f.cik}
                onClick={() => { setSelectedFund(f); setQuery(f.name); setTab('all'); }}
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
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, marginLeft: 16 }}>Last filed {f.lastFiled}</span>
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
              <div style={{ padding: '20px 16px', borderRadius: 10, background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.25)', marginTop: 16 }}>
                <p style={{ color: '#F6465D', fontSize: 13, margin: '0 0 4px' }}>⚠ Holdings unavailable</p>
                <p style={{ color: 'var(--text-tertiary)', fontSize: 12, margin: 0 }}>EDGAR may be temporarily unavailable. Try again or search for another fund.</p>
              </div>
            )}

            {!holdingsLoading && holdingsData && holdingsData.current.length === 0 && !holdingsError && (
              <div style={{ padding: '28px 0', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  No holdings data available
                </p>
                <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 14 }}>
                  This fund may use a non-standard filing format or the data wasn't parseable from EDGAR.
                </p>
                <a
                  href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${selectedFund?.cik}&type=13F&dateb=&owner=include&count=5`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-blue-light)', fontSize: 13 }}
                >
                  View this fund on EDGAR →
                </a>
              </div>
            )}

            {!holdingsLoading && holdingsData && holdingsData.current.length > 0 && (
              <>
                {/* Stat cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, margin: '20px 0 24px' }}>
                  {[
                    { label: 'Total Value',  value: fmt(meta?.totalValue ?? 0),                        color: 'var(--text-primary)' },
                    { label: 'Positions',    value: (meta?.positionCount ?? 0).toLocaleString(),        color: 'var(--text-primary)' },
                    { label: 'New / Added',  value: `+${(meta?.newCount ?? 0) + (meta?.increasedCount ?? 0)}`, color: '#05B169' },
                    { label: 'Reduced',      value: `${meta?.decreasedCount ?? 0}`,                    color: '#F6465D' },
                    { label: 'Exited',       value: `${meta?.exitedCount ?? 0}`,                       color: '#F6465D' },
                    { label: 'Period',       value: meta?.period || '—',                               color: 'var(--text-primary)' },
                  ].map(c => (
                    <div key={c.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                      <p style={{ margin: '0 0 2px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{c.label}</p>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: c.color, fontFamily: "'Roboto Mono', monospace" }}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Sector chart */}
                <SectorBreakdown holdings={holdingsData.current} />

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {([
                    { key: 'all',     label: `All (${holdingsData.current.length})` },
                    { key: 'long',    label: `Long (${longCount})` },
                    { key: 'options', label: `Options (${optionsCount})` },
                    { key: 'new',     label: `Active (${activityCount})` },
                    { key: 'exited',  label: `Exited (${meta?.exitedCount ?? 0})` },
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

                {/* Options tab: split calls vs puts */}
                {/* Large only toggle — shown on non-options tabs */}
                {tab !== 'options' && tab !== 'exited' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <button onClick={() => setLargeOnly(v => !v)} style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: largeOnly ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                      color: largeOnly ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${largeOnly ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                      transition: 'all 120ms',
                    }}>
                      {largeOnly ? '≥$10M ✓' : '≥$10M only'}
                    </button>
                  </div>
                )}

                {tab === 'options' ? (
                  <OptionsSection holdings={holdingsData.current} navigateToStock={navigateToStock} />
                ) : (
                  <>
                    <HoldingsTable holdings={filtered} navigateToStock={navigateToStock} navigatingIdx={navigatingIdx} />
                    {filtered.length > 100 && (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                        Showing top 100 of {filtered.length} positions
                      </p>
                    )}
                  </>
                )}

                {/* AI Chat */}
                <FundAIChat fund={holdingsData.fund} holdings={holdingsData.current} meta={holdingsData.meta} />
              </>
            )}
          </>
        )}

        {/* Big fund filing changes landing page */}
        {!selectedFund && !debouncedQuery && (
          <div style={{ marginTop: 24 }}>
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em' }}>
                Big Fund Filing Changes
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                Latest 13F changes from major managers. New, added, reduced, and exited positions only.
              </p>
            </div>

            {!bigFundChangesData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="animate-pulse" style={{ height: 88, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', opacity: 0.8 - i * 0.08 }} />
                ))}
              </div>
            )}

            {bigFundChangesData && bigFundChangesData.funds.length === 0 && (
              <div style={{ padding: '20px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  No big fund filing changes are available right now.
                </p>
              </div>
            )}

            {bigFundChangesData && bigFundChangesData.funds.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bigFundChangesData.funds.map(f => (
                  <button
                    key={f.cik}
                    onClick={() => { setSelectedFund({ cik: f.cik, name: f.fund, lastFiled: f.filingDate }); setQuery(f.fund); setTab('new'); }}
                    style={{
                      display: 'block', padding: '12px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      transition: 'border-color 120ms', width: '100%',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.fund}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace", flexShrink: 0 }}>
                        {f.filingDate}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginBottom: f.topChanged.length ? 9 : 0 }}>
                      {[
                        { label: 'New', value: f.newCount, color: '#05B169' },
                        { label: 'Added', value: f.increasedCount, color: '#05B169' },
                        { label: 'Reduced', value: f.decreasedCount, color: '#F6465D' },
                        { label: 'Exited', value: f.exitedCount, color: '#F6465D' },
                      ].map(stat => (
                        <div key={stat.label} style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{stat.label}</span>
                          <span style={{ display: 'block', fontSize: 13, color: stat.color, fontFamily: "'Roboto Mono', monospace", fontWeight: 800 }}>{stat.value}</span>
                        </div>
                      ))}
                    </div>
                    {f.topChanged.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {f.topChanged.slice(0, 4).map((item, i) => {
                          const color = item.changeType === 'new' || item.changeType === 'increased' ? '#05B169' : '#F6465D';
                          let label = 'EXIT';
                          if (item.changeType === 'new') label = 'NEW';
                          else if (item.changeType === 'increased') label = '+' + Math.abs(item.changePct).toFixed(0) + '%';
                          else if (item.changeType === 'decreased') label = '-' + Math.abs(item.changePct).toFixed(0) + '%';
                          return (
                            <span key={item.cusip + '-' + i} style={{ maxWidth: '100%', fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <strong style={{ color, marginRight: 4 }}>{label}</strong>{item.name} {fmt(item.value)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </button>
                ))}
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                  {bigFundChangesData.funds.length} major managers shown. Tap one for filing detail.
                </p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
