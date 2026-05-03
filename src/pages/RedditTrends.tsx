import { useMemo, useState } from 'react';
import { ExternalLink, Flame, MessageCircle, Newspaper, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RedditTrendFilter, RedditTrendItem } from '../api/reddit';
import { useRedditTrends } from '../hooks/useRedditTrends';
import { useStockQuotes } from '../hooks/useStockData';
import { DataStatus } from '../components/ui/DataStatus';
import type { Quote } from '../api/types';
import { useLeagueStore } from '../store/leagueStore';

const FILTERS: Array<{ id: RedditTrendFilter; label: string }> = [
  { id: 'all-stocks', label: 'Stocks' },
  { id: 'wallstreetbets', label: 'WSB' },
  { id: 'options', label: 'Options' },
  { id: 'stocks', label: 'r/stocks' },
  { id: 'investing', label: 'Investing' },
  { id: 'Daytrading', label: 'Daytrading' },
  { id: 'SPACs', label: 'SPACs' },
];

type SpikeWindow = '24h' | '48h';

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat([], { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat([], { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
}

function formatPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatSpikePct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'building';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function pctTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'var(--text-tertiary)';
  if (value > 0) return 'var(--color-up)';
  if (value < 0) return 'var(--color-down)';
  return 'var(--text-tertiary)';
}

function buyPressureLabel(item: RedditTrendItem) {
  if (item.buyPressure.net === 'none') return 'No buy/sell tape';
  const net = item.buyPressure.net === 'buy' ? 'Net buy' : item.buyPressure.net === 'sell' ? 'Net sell' : 'Mixed';
  const value = Math.max(item.buyPressure.buyValue, item.buyPressure.sellValue);
  return `${net} ${formatCurrency(value)}`;
}

function confirmationTone(score: number): 'hot' | 'good' | 'neutral' {
  if (score >= 80) return 'hot';
  if (score >= 40) return 'good';
  return 'neutral';
}

function SignalPill({ label, tone = 'neutral' }: { label: string; tone?: 'hot' | 'good' | 'bad' | 'neutral' }) {
  const palette = {
    hot: { color: '#F7931A', background: 'rgba(247,147,26,0.13)', border: 'rgba(247,147,26,0.28)' },
    good: { color: 'var(--color-up)', background: 'rgba(14,203,129,0.10)', border: 'rgba(14,203,129,0.22)' },
    bad: { color: 'var(--color-down)', background: 'rgba(246,70,93,0.10)', border: 'rgba(246,70,93,0.22)' },
    neutral: { color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: 'var(--border-subtle)' },
  }[tone];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 700, color: palette.color, background: palette.background, border: `1px solid ${palette.border}` }}>
      {label}
    </span>
  );
}

function TrendRow({ item, quote, spikeWindow }: { item: RedditTrendItem; quote?: Quote; spikeWindow: SpikeWindow }) {
  const spikePct = spikeWindow === '48h' ? item.mentionChange48hPct : item.mentionChangePct;
  const spikeChange = spikeWindow === '48h' ? item.mentionChange48h : item.mentionChange;
  const mentionTone = (spikePct ?? 0) >= 50 || item.velocityScore >= 70 ? 'hot' : 'neutral';
  const buyTone = item.buyPressure.net === 'buy' ? 'good' : item.buyPressure.net === 'sell' ? 'bad' : 'neutral';
  const price = quote
    ? { last: quote.c, changePct1d: quote.dp }
    : item.price;

  return (
    <article data-agent-section="reddit-trend-row" data-symbol={item.ticker} className="grid md:grid-cols-[112px_minmax(0,1.2fr)_120px_150px_minmax(190px,0.95fr)_minmax(210px,1fr)] gap-3 md:gap-4" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'start' }}>
      <div>
        <p style={{ margin: '0 0 5px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: 'var(--text-tertiary)' }}>Mention Spike</p>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: pctTone(spikePct) }}>
          {formatSpikePct(spikePct)}
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 700, color: pctTone(item.mentionChange7dPct) }}>
          {spikeWindow.toUpperCase()} window
        </p>
        <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>
          velocity {item.velocityScore}/100
        </p>
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/stock/${item.ticker}`} style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>
            {item.ticker}
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 8 }}>
          <SignalPill label={`${formatNumber(item.mentions)} mentions`} tone={mentionTone} />
          <SignalPill label={`${formatNumber(item.upvotes)} upvotes`} />
          <SignalPill label={spikeChange == null ? `${spikeWindow} base building` : `${spikeChange > 0 ? '+' : ''}${formatNumber(spikeChange)} vs ${spikeWindow}`} tone={mentionTone} />
        </div>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: 'var(--text-tertiary)' }}>Price</p>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{formatCurrency(price.last)}</p>
        <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 700, color: pctTone(price.changePct1d) }}>
          1D {formatPct(price.changePct1d)}
        </p>
      </div>

      <div>
        <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: 'var(--text-tertiary)' }}>Buy/Sell Context</p>
        <SignalPill label={buyPressureLabel(item)} tone={buyTone} />
        <p style={{ margin: '7px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
          {item.buyPressure.tradeCount ? `${item.buyPressure.tradeCount} recent insider trades` : 'No recent insider tape match'}
        </p>
      </div>

      <div>
        <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: 'var(--text-tertiary)' }}>Convergence</p>
        <SignalPill label={`${item.confirmation.score}/100`} tone={confirmationTone(item.confirmation.score)} />
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
          {item.confirmation.reasons.length ? item.confirmation.reasons.slice(0, 4).map((reason) => (
            <SignalPill key={reason} label={reason} tone={reason.includes('portfolio') || reason.includes('watchlist') ? 'good' : 'neutral'} />
          )) : (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No filing/congress collision</span>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: 'var(--text-tertiary)' }}>Catalyst</p>
        {item.latestNews ? (
          <a href={item.latestNews.url ?? undefined} target="_blank" rel="noreferrer" style={{ display: 'block', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, lineHeight: 1.45, textDecoration: 'none' }}>
            {item.latestNews.headline}
            {item.latestNews.url && <ExternalLink size={12} style={{ marginLeft: 5, color: 'var(--text-tertiary)', verticalAlign: '-1px' }} />}
          </a>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>No scored news catalyst matched yet</p>
        )}
        {item.latestNews && (
          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            {item.latestNews.source} {formatTime(item.latestNews.publishedAt)}
            {item.latestNews.impactScore != null ? ` · ${item.latestNews.impactScore}/10 impact` : ''}
          </p>
        )}
      </div>
    </article>
  );
}

export default function RedditTrendsPage() {
  const player = useLeagueStore((state) => state.player);
  const [filter, setFilter] = useState<RedditTrendFilter>('all-stocks');
  const [spikeWindow, setSpikeWindow] = useState<SpikeWindow>('24h');
  const [query, setQuery] = useState('');
  const { data, error, isLoading, isFetching, dataUpdatedAt } = useRedditTrends({ filter, limit: 60, playerId: player?.id });

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const results = data?.results ?? [];
  const filteredResults = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return results;
    return results.filter((item) => item.ticker.includes(q) || item.name.toUpperCase().includes(q));
  }, [query, results]);
  const quoteSymbols = useMemo(() => filteredResults.slice(0, 25).map((item) => item.ticker), [filteredResults]);
  const { quoteMap } = useStockQuotes(quoteSymbols);

  const hotCount = filteredResults.filter((item) => item.velocityScore >= 70).length;
  const newsCount = filteredResults.filter((item) => item.latestNews).length;
  const buyCount = filteredResults.filter((item) => item.buyPressure.net === 'buy').length;
  const convergenceCount = filteredResults.filter((item) => item.confirmation.score >= 40).length;

  return (
    <div data-agent-section="reddit-trends-page" className="px-3 sm:px-4 md:px-8 pt-4 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 14 }}>
        <div>
          <div className="flex items-center gap-2">
            <Flame size={18} style={{ color: '#F7931A' }} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Reddit Trends</h1>
          </div>
          <p className="hidden md:block" style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 760 }}>
            Social mention velocity compared with price reaction, scored news catalysts, and recent insider buy/sell pressure.
          </p>
        </div>
        <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
      </div>

      <div data-agent-section="reddit-trends-controls" className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 12 }}>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => {
            const active = filter === option.id;
            return (
              <button key={option.id} onClick={() => setFilter(option.id)} style={{ padding: '7px 11px', borderRadius: 999, border: `1px solid ${active ? 'rgba(247,147,26,0.45)' : 'var(--border-default)'}`, background: active ? 'rgba(247,147,26,0.13)' : 'var(--bg-elevated)', color: active ? '#F7931A' : 'var(--text-secondary)', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1" style={{ padding: 3, borderRadius: 999, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          {(['24h', '48h'] as const).map((window) => {
            const active = spikeWindow === window;
            return (
              <button key={window} onClick={() => setSpikeWindow(window)} style={{ padding: '6px 11px', borderRadius: 999, border: 'none', background: active ? '#F7931A' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
                {window} Spike
              </button>
            );
          })}
        </div>
      </div>

      <div data-agent-section="reddit-trends-summary" className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_160px_160px] gap-2" style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '0 12px' }}>
          <Search size={15} style={{ color: 'var(--text-tertiary)' }} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by ticker or company" style={{ flex: 1, minWidth: 0, height: 42, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }} />
        </label>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 800 }}>Hot velocity</p>
          <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900, color: '#F7931A' }}>{hotCount}</p>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 800 }}>With catalyst</p>
          <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>{newsCount}</p>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 800 }}>Net buy tape</p>
          <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900, color: 'var(--color-up)' }}>{buyCount}</p>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 800 }}>Converged</p>
          <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900, color: '#F7931A' }}>{convergenceCount}</p>
        </div>
      </div>

      {data?.note && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(247,147,26,0.22)', borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{data.note}</p>
        </div>
      )}

      {isLoading ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Loading Reddit mention tape...</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>ApeWisdom mentions are being enriched with price, news, filings, congress, and insider context.</p>
        </div>
      ) : error ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 18, padding: 18 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Reddit Trends could not be loaded right now.</p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>Expected endpoint: <code>/api/reddit-trends</code></p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>{(error as Error).message}</p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, padding: 20 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>No matching Reddit names in this view</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>Try a broader subreddit filter or clear the ticker search.</p>
        </div>
      ) : (
        <div data-agent-section="reddit-trends-list" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <div className="hidden md:grid" style={{ gridTemplateColumns: '112px minmax(0,1.2fr) 120px 150px minmax(190px,0.95fr) minmax(210px,1fr)', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            <span>Change</span>
            <span>Reddit Flow</span>
            <span>Price</span>
            <span>Buys/Sells</span>
            <span>Convergence</span>
            <span>News Catalyst</span>
          </div>
          {filteredResults.map((item) => <TrendRow key={`${item.rank}-${item.ticker}`} item={item} quote={quoteMap[item.ticker]} spikeWindow={spikeWindow} />)}
        </div>
      )}

      <div className="flex items-center gap-2" style={{ marginTop: 12, color: 'var(--text-tertiary)', fontSize: 12 }}>
        <MessageCircle size={13} />
        <span>Mentions source: ApeWisdom. Confirmation uses TARS news, filings, congress, insider, portfolio, and watchlist data when a ticker match exists.</span>
        <Newspaper size={13} />
      </div>
    </div>
  );
}
