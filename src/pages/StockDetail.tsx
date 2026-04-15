import { useRef, useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Check, RefreshCw, ArrowUpDown, Send, Bot } from 'lucide-react';
import { useStockCandles, useStockQuote, useStockProfile } from '../hooks/useStockData';
import { useInsiderData } from '../hooks/useInsiderData';
import { useRealTimeQuote } from '../hooks/useRealTimeQuote';
import { useStockNews } from '../hooks/useStockNews';
import { useChartStore } from '../store/chartStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { useLeagueStore } from '../store/leagueStore';
import { StockChart } from '../components/chart/StockChart';
import type { OHLCVBar, ChartType, InsiderTransaction, NewsItem } from '../api/types';
import { PriceDisplay } from '../components/ui/PriceDisplay';
import { TimeRangePicker } from '../components/ui/TimeRangePicker';
import { InsiderPanel } from '../components/insider/InsiderPanel';
import { NewsSection } from '../components/news/NewsSection';
import { TrendLinesLegend } from '../components/chart/TrendLines';
import { PriceHeaderSkeleton } from '../components/ui/LoadingSkeleton';
import TradeModal from '../components/trade/TradeModal';
import { formatLargeNumber, formatVolume, formatPrice } from '../utils/formatters';
import { isTSXTicker } from '../utils/marketHours';

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function StockDetail() {
  const { symbol = 'AAPL' } = useParams<{ symbol: string }>();

  const {
    timeRange, chartType, showSMA20, showSMA50, showVolume,
    setTimeRange, setChartType, toggleSMA20, toggleSMA50, toggleVolume,
  } = useChartStore();
  const { hasItem, addItem, removeItem } = useWatchlistStore();
  const { player } = useLeagueStore();
  const [showTradeModal, setShowTradeModal] = useState(false);

  const { data: candles, isLoading: candlesLoading, error: candlesError, refetch: refetchCandles } = useStockCandles(symbol, timeRange);
  const { data: quote, isLoading: quoteLoading } = useStockQuote(symbol);
  const { data: profile, isLoading: profileLoading } = useStockProfile(symbol);
  const { data: insiders, isLoading: insidersLoading } = useInsiderData(symbol);
  const { data: news } = useStockNews(symbol);
  const liveQuote = useRealTimeQuote(symbol);

  const inWatchlist = hasItem(symbol);
  const isCanadian = isTSXTicker(symbol);
  const currency = isCanadian ? 'CAD' : 'USD';

  // Market cap: Canadian stocks get raw $ from TMX, US stocks get millions from Finnhub
  const marketCap = isCanadian
    ? (quote?._marketCap ? formatLargeNumber(quote._marketCap) : (profile?.marketCapitalization ? formatLargeNumber(profile.marketCapitalization * 1e6) : '—'))
    : (profile?.marketCapitalization ? formatLargeNumber(profile.marketCapitalization * 1e6) : '—');

  // Volume: prefer live quote volume for CA, last candle for US
  const lastCandle = candles && candles.length > 0 ? candles[candles.length - 1] : null;
  const volumeDisplay = isCanadian
    ? (quote?._volume ? formatVolume(quote._volume) : (lastCandle ? formatVolume(lastCandle.volume) : '—'))
    : (lastCandle ? formatVolume(lastCandle.volume) : '—');

  const dayHigh = quote?.h ? formatPrice(quote.h, currency) : '—';
  const dayLow  = quote?.l ? formatPrice(quote.l, currency) : '—';

  return (
    <div className="flex flex-col" style={{ minHeight: '100%', background: 'var(--bg-primary)' }}>

      {/* ── Price Header ── */}
      <div className="px-4 md:px-8 pt-5 md:pt-8 pb-4 md:pb-6" style={{ background: 'var(--bg-primary)' }}>
        {quoteLoading || profileLoading ? (
          <PriceHeaderSkeleton />
        ) : (
          <div className="flex items-start justify-between gap-3 md:gap-6">
            <PriceDisplay
              symbol={symbol}
              companyName={profile?.name || (isCanadian ? quote?._name : undefined)}
              exchange={isCanadian ? (quote?._exchange || 'TSX') : (profile?.exchange || 'NASDAQ')}
              quote={quote}
              livePrice={liveQuote?.price}
              currency={currency}
            />

            {/* Buttons row */}
            <div className="flex items-center gap-2 flex-shrink-0 mt-1">
              {/* Trade button — only if logged in + Supabase configured */}
              {SUPABASE_CONFIGURED && player && (
                <button
                  onClick={() => setShowTradeModal(true)}
                  className="flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: 'var(--color-up)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    minHeight: 44,
                    transition: 'opacity 150ms',
                  }}
                >
                  <ArrowUpDown size={14} />
                  <span className="hidden sm:inline">Trade</span>
                </button>
              )}

              {/* Watch button */}
              <button
                onClick={() => {
                  if (inWatchlist) removeItem(symbol);
                  else addItem({ symbol, name: profile?.name, exchange: profile?.exchange });
                }}
                className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-sm font-semibold"
                style={{
                  background: inWatchlist ? 'var(--bg-elevated)' : 'var(--accent-blue)',
                  color: inWatchlist ? 'var(--text-secondary)' : '#fff',
                  border: `1px solid ${inWatchlist ? 'var(--border-default)' : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                  letterSpacing: '-0.01em',
                  minHeight: 44,
                }}
                onMouseEnter={e => {
                  if (!inWatchlist) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-blue-light)';
                }}
                onMouseLeave={e => {
                  if (!inWatchlist) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-blue)';
                }}
              >
                {inWatchlist ? <Check size={15} /> : <Plus size={15} />}
                <span className="hidden sm:inline">{inWatchlist ? 'Watching' : 'Watch'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Chart Controls ── */}
      <div
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {/* Scrollable row on mobile, flex-wrap on desktop */}
        <div
          className="overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div
            className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-4"
            style={{ minWidth: 'max-content' }}
          >
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: 'var(--border-default)', flexShrink: 0 }} />

            <TrendLinesLegend
              showSMA20={showSMA20}
              showSMA50={showSMA50}
              onToggleSMA20={toggleSMA20}
              onToggleSMA50={toggleSMA50}
            />

            {/* Chart type toggle */}
            <div
              className="flex rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', flexShrink: 0 }}
            >
              {(['area', 'candlestick'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className="px-3 text-xs font-semibold"
                  style={{
                    height: 44,
                    background: chartType === type ? 'var(--bg-hover)' : 'transparent',
                    color: chartType === type ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 150ms ease-out',
                  }}
                >
                  {type === 'area' ? 'Area' : 'Candle'}
                </button>
              ))}
            </div>

            {/* Volume toggle */}
            <button
              onClick={toggleVolume}
              className="px-3 text-xs font-semibold rounded-xl flex-shrink-0"
              style={{
                height: 44,
                background: showVolume ? 'rgba(22,82,240,0.15)' : 'var(--bg-elevated)',
                color: showVolume ? 'var(--accent-blue-light)' : 'var(--text-tertiary)',
                border: `1px solid ${showVolume ? 'rgba(45,107,255,0.3)' : 'var(--border-default)'}`,
                cursor: 'pointer',
                transition: 'all 150ms ease-out',
              }}
            >
              Vol
            </button>

            {candlesError && (
              <button
                onClick={() => refetchCandles()}
                className="flex items-center gap-1.5 px-3 text-xs font-semibold rounded-xl flex-shrink-0"
                style={{
                  height: 44,
                  color: 'var(--color-down)',
                  background: 'rgba(246,70,93,0.1)',
                  border: '1px solid rgba(246,70,93,0.2)',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={11} /> Retry
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div style={{ background: 'var(--bg-primary)' }}>
        <ChartWithResponsiveHeight
          key={symbol}
          data={candles || []}
          chartType={chartType}
          showSMA20={showSMA20}
          showSMA50={showSMA50}
          showVolume={showVolume}
          insiders={insiders || []}
          loading={candlesLoading}
          currency={currency}
        />
      </div>

      {/* ── Stats Cards ── */}
      <div
        className="px-4 md:px-8 py-4 md:py-6"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Market Cap" value={marketCap} />
          <StatCard label="Volume" value={volumeDisplay} />
          <StatCard label="Day High" value={dayHigh} positive />
          <StatCard label="Day Low" value={dayLow} negative />
        </div>
      </div>

      {/* ── Insider Panel ── */}
      <div className="px-4 md:px-8 pb-4">
        <InsiderPanel
          symbol={symbol}
          transactions={insiders || []}
          candles={candles || []}
          loading={insidersLoading}
          error={null}
          currency={currency}
          isCanadian={isCanadian}
        />
      </div>

      {/* ── Ask AI Chat ── */}
      <div className="px-4 md:px-8 pb-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <StockAIChat
          symbol={symbol}
          context={{
            price: quote?.c ? `${currency === 'CAD' ? 'CA$' : 'US$'}${quote.c}` : undefined,
            change: quote?.dp != null ? `${quote.dp >= 0 ? '+' : ''}${quote.dp.toFixed(2)}%` : undefined,
            marketCap,
            volume: volumeDisplay,
            exchange: isCanadian ? (quote?._exchange || 'TSX') : (profile?.exchange || 'NASDAQ'),
            insiders: insiders || [],
            candles: (candles || []).slice(-90),
            news: (news || []).slice(0, 6),
          }}
        />
      </div>

      {/* ── Market Signals (News / Analyst / 13D Filings) ── */}
      <div className="px-4 md:px-8 pb-10">
        <NewsSection
          symbol={symbol}
          isCanadian={isCanadian}
          currentPrice={liveQuote?.price ?? quote?.c}
          currency={currency}
        />
      </div>

      {/* Trade modal */}
      {showTradeModal && quote?.c && (
        <TradeModal
          symbol={symbol}
          exchange={isCanadian ? (quote._exchange || 'TSX') : (profile?.exchange || 'NYSE')}
          companyName={profile?.name || quote._name || symbol}
          currentPrice={liveQuote?.price ?? quote.c}
          currency={currency}
          onClose={() => setShowTradeModal(false)}
        />
      )}
    </div>
  );
}

// Measures container width and picks 280px (mobile) or 440px (desktop)
function ChartWithResponsiveHeight({
  data, chartType, showSMA20, showSMA50, showVolume, insiders, loading, currency,
}: {
  data: OHLCVBar[];
  chartType: ChartType;
  showSMA20: boolean;
  showSMA50: boolean;
  showVolume: boolean;
  insiders: InsiderTransaction[];
  loading: boolean;
  currency: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(440);

  useEffect(() => {
    const update = () => {
      if (wrapRef.current) {
        setHeight(wrapRef.current.clientWidth < 640 ? 280 : 440);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      <StockChart
        data={data}
        chartType={chartType}
        showSMA20={showSMA20}
        showSMA50={showSMA50}
        showVolume={showVolume}
        insiders={insiders}
        loading={loading}
        currency={currency}
        height={height}
      />
    </div>
  );
}

interface ChatMessage { role: 'user' | 'ai'; text: string; }

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^Bottom line:\s*/gim, '<strong>Bottom line:</strong> ')
    .replace(/^•\s+/gm, '<span style="display:inline-block;margin-left:4px">•</span> ')
    .replace(/\n/g, '<br/>');
}

function StockAIChat({ symbol, context }: {
  symbol: string;
  context: {
    price?: string; change?: string; marketCap?: string;
    volume?: string; exchange?: string; insiders?: InsiderTransaction[];
    candles?: OHLCVBar[];
    news?: NewsItem[];
  };
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new message
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = useCallback(async (q?: string) => {
    const question = (q ?? input).trim();
    if (!question || loading) return;
    setInput('');
    setIsOpen(true);
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ask-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, symbol, context }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer || data.error || 'No response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Request failed — check your connection.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, symbol, context]);

  const SUGGESTIONS = [
    `Read the chart, insiders, and news for ${symbol}. What is the setup?`,
    `Where are the key support and resistance levels for ${symbol}?`,
    `What do Bollinger Bands and recent price action say about ${symbol}?`,
    `Give me the bullish and bearish case for ${symbol} right now.`,
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Bot size={15} color="var(--accent-blue-light)" />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          Ask AI about {symbol}
        </span>
      </div>

      {/* Suggestion chips — hide once conversation starts */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => send(s)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)', fontFamily: "'Inter', sans-serif",
                transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-blue)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
            >{s}</button>
          ))}
        </div>
      )}

      {/* Chat messages */}
      {isOpen && messages.length > 0 && (
        <div style={{
          marginBottom: 10, maxHeight: 340, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '12px 14px', borderRadius: 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: '8px 12px', borderRadius: 10,
                maxWidth: '85%', fontFamily: "'Inter', sans-serif",
                background: m.role === 'user' ? 'var(--accent-blue)' : 'var(--bg-hover)',
                color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
              }} dangerouslySetInnerHTML={{ __html: m.role === 'ai' ? renderMarkdown(m.text) : escapeHtml(m.text) }} />
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: 4, padding: '8px 12px' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-tertiary)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Ask anything about ${symbol}…`}
          disabled={loading}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            color: 'var(--text-primary)', fontSize: 13, fontFamily: "'Inter', sans-serif",
            outline: 'none', opacity: loading ? 0.6 : 1,
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
        />
        <button
          type="submit" disabled={!input.trim() || loading}
          style={{
            width: 44, height: 44, borderRadius: 10, border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
            background: input.trim() && !loading ? 'var(--accent-blue)' : 'var(--bg-elevated)',
            color: input.trim() && !loading ? '#fff' : 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'all 150ms',
          }}
        ><Send size={15} /></button>
      </form>
    </div>
  );
}

function StatCard({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const valueColor = positive
    ? 'var(--color-up)'
    : negative
    ? 'var(--color-down)'
    : 'var(--text-primary)';

  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="text-xs font-semibold uppercase mb-2"
        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.07em' }}
      >
        {label}
      </div>
      <div
        className="text-xl font-semibold mono"
        style={{ color: valueColor, fontFamily: "'Roboto Mono', monospace", letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
    </div>
  );
}
