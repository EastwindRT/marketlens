import { useRef, useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Check, RefreshCw, ArrowUpDown, Send, Bot } from 'lucide-react';
import { useStockCandles, useStockQuote, useStockProfile } from '../hooks/useStockData';
import { useInsiderData } from '../hooks/useInsiderData';
import { useRealTimeQuote } from '../hooks/useRealTimeQuote';
import { useStockNews } from '../hooks/useStockNews';
import { useStockAIContext } from '../hooks/useStockAIContext';
import { useEdgarFilings } from '../hooks/useEdgarFilings';
import { useChartStore } from '../store/chartStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { useLeagueStore } from '../store/leagueStore';
import { StockChart } from '../components/chart/StockChart';
import type { OHLCVBar, ChartType, InsiderTransaction, NewsItem } from '../api/types';
import { PriceDisplay } from '../components/ui/PriceDisplay';
import { TimeRangePicker } from '../components/ui/TimeRangePicker';
import { InsiderPanel } from '../components/insider/InsiderPanel';
import { NewsSection } from '../components/news/NewsSection';
import { PeerComparison } from '../components/stock/PeerComparison';
import { DeepAnalyzeDrawer, type DeepAnalyzeTarget } from '../components/ai/DeepAnalyzeDrawer';
import { DeepAnalyzeButton } from '../components/ai/DeepAnalyzeButton';
import { TrendLinesLegend } from '../components/chart/TrendLines';
import { FilingSheet } from '../components/ui/FilingSheet';
import { PriceHeaderSkeleton } from '../components/ui/LoadingSkeleton';
import TradeModal from '../components/trade/TradeModal';
import { formatLargeNumber, formatVolume, formatPrice } from '../utils/formatters';
import { calculateRelativeVolume, calculateSMA } from '../utils/indicators';
import { isTSXTicker } from '../utils/marketHours';
import type { MarketFiling } from '../api/edgar';

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
  const isCanadian = isTSXTicker(symbol);
  const currency = isCanadian ? 'CAD' : 'USD';
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [deepTarget, setDeepTarget] = useState<DeepAnalyzeTarget | null>(null);
  const [selectedFiling, setSelectedFiling] = useState<MarketFiling | null>(null);

  const { data: candles, isLoading: candlesLoading, error: candlesError, refetch: refetchCandles } = useStockCandles(symbol, timeRange);
  const { data: quote, isLoading: quoteLoading } = useStockQuote(symbol);
  const { data: profile, isLoading: profileLoading } = useStockProfile(symbol);
  const { data: insiders, isLoading: insidersLoading } = useInsiderData(symbol);
  const { data: filings, isLoading: filingsLoading } = useEdgarFilings(symbol, isCanadian);
  const { data: news } = useStockNews(symbol);
  // Fundamentals + analyst context for Ask AI chat (US stocks only)
  const { data: aiFundamentals } = useStockAIContext(symbol);
  const liveQuote = useRealTimeQuote(symbol);

  const inWatchlist = hasItem(symbol);

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
  const rvolStats = calculateRelativeVolume(candles || [], 20);
  const sma20Series = candles && candles.length >= 20 ? calculateSMA(candles, 20) : [];
  const sma50Series = candles && candles.length >= 50 ? calculateSMA(candles, 50) : [];
  const sma20 = sma20Series.length > 0 ? sma20Series[sma20Series.length - 1].value : null;
  const sma50 = sma50Series.length > 0 ? sma50Series[sma50Series.length - 1].value : null;
  const latestClose = lastCandle?.close ?? null;
  const nextEarningsDate = aiFundamentals?.upcomingEarningsDate ?? null;

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
          filings={filings || []}
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

      <div className="px-4 md:px-8 pb-4">
        <SignalSummaryPanel
          symbol={symbol}
          currency={currency}
          latestClose={latestClose}
          sma20={sma20}
          sma50={sma50}
          rvol={rvolStats.rvol}
          averageVolume={rvolStats.averageVolume}
          latestVolume={rvolStats.latestVolume}
          insiderCount={insiders?.length ?? 0}
          filingCount={filings?.length ?? 0}
          nextEarningsDate={nextEarningsDate}
          isCanadian={isCanadian}
        />
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

      <div className="px-4 md:px-8 pb-4">
        <RecentFilingsPanel
          symbol={symbol}
          isCanadian={isCanadian}
          filings={filings ?? []}
          loading={filingsLoading}
          onOpenFiling={setSelectedFiling}
        />
      </div>

      {/* ── Ask AI Chat ── */}
      <div className="px-4 md:px-8 pb-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <StockAIChat
          symbol={symbol}
          context={{
            companyName: profile?.name || quote?._name || symbol,
            price: quote?.c ? `${currency === 'CAD' ? 'CA$' : 'US$'}${quote.c}` : undefined,
            priceRaw: quote?.c,
            change: quote?.dp != null ? `${quote.dp >= 0 ? '+' : ''}${quote.dp.toFixed(2)}%` : undefined,
            marketCap,
            volume: volumeDisplay,
            exchange: isCanadian ? (quote?._exchange || 'TSX') : (profile?.exchange || 'NASDAQ'),
            insiders: insiders || [],
            candles: (candles || []).slice(-90),
            news: (news || []).slice(0, 6),
            fundamentals: aiFundamentals ? { ...aiFundamentals, currentPrice: quote?.c } : undefined,
          }}
        />
        <div style={{ marginTop: 12 }}>
          <DeepAnalyzeButton
            variant="full"
            onClick={() => setDeepTarget({
              type: 'stock',
              symbol,
              context: {
                price: quote?.c ? `${currency === 'CAD' ? 'CA$' : 'US$'}${quote.c}` : undefined,
                priceRaw: quote?.c,
                change: quote?.dp != null ? `${quote.dp >= 0 ? '+' : ''}${quote.dp.toFixed(2)}%` : undefined,
                marketCap,
                volume: volumeDisplay,
                exchange: isCanadian ? (quote?._exchange || 'TSX') : (profile?.exchange || 'NASDAQ'),
                insiders: insiders || [],
                candles: (candles || []).slice(-90),
                news: (news || []).slice(0, 8),
                fundamentals: aiFundamentals ? { ...aiFundamentals, currentPrice: quote?.c } : undefined,
              },
            })}
          />
        </div>
      </div>

      {/* ── Peer Comparison ── */}
      {!isCanadian && (
        <div className="px-4 md:px-8 pb-2">
          <PeerComparison symbol={symbol} />
        </div>
      )}

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
      <DeepAnalyzeDrawer
        open={deepTarget !== null}
        onClose={() => setDeepTarget(null)}
        target={deepTarget}
      />

      <FilingSheet filing={selectedFiling} onClose={() => setSelectedFiling(null)} />

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
  data, chartType, showSMA20, showSMA50, showVolume, insiders, filings, loading, currency,
}: {
  data: OHLCVBar[];
  chartType: ChartType;
  showSMA20: boolean;
  showSMA50: boolean;
  showVolume: boolean;
  insiders: InsiderTransaction[];
  filings: MarketFiling[];
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
        filings={filings}
        loading={loading}
        currency={currency}
        height={height}
      />
    </div>
  );
}

function SignalSummaryPanel({
  symbol,
  currency,
  latestClose,
  sma20,
  sma50,
  rvol,
  averageVolume,
  latestVolume,
  insiderCount,
  filingCount,
  nextEarningsDate,
  isCanadian,
}: {
  symbol: string;
  currency: string;
  latestClose: number | null;
  sma20: number | null;
  sma50: number | null;
  rvol: number | null;
  averageVolume: number | null;
  latestVolume: number | null;
  insiderCount: number;
  filingCount: number;
  nextEarningsDate: string | null;
  isCanadian: boolean;
}) {
  const priceVs20 = latestClose != null && sma20 ? ((latestClose - sma20) / sma20) * 100 : null;
  const priceVs50 = latestClose != null && sma50 ? ((latestClose - sma50) / sma50) * 100 : null;
  const dmaStack = sma20 != null && sma50 != null
    ? sma20 > sma50
      ? '20-day average is above the 50-day average'
      : sma20 < sma50
      ? '20-day average is below the 50-day average'
      : '20-day and 50-day averages are nearly flat'
    : 'Need more trading history';
  const trendLabel = !latestClose || !sma20 || !sma50
    ? 'Building'
    : latestClose > sma20 && sma20 > sma50
    ? 'Strong Uptrend'
    : latestClose < sma20 && sma20 < sma50
    ? 'Weak Trend'
    : 'Mixed Trend';

  const trendTone = trendLabel === 'Strong Uptrend'
    ? 'var(--color-up)'
    : trendLabel === 'Weak Trend'
    ? 'var(--color-down)'
    : 'var(--accent-blue-light)';

  const participationLabel = rvol == null
    ? 'Normal'
    : rvol >= 2
    ? 'Heavy Participation'
    : rvol >= 1.2
    ? 'Above Average'
    : rvol <= 0.8
    ? 'Light Participation'
    : 'Normal';

  const participationTone = rvol == null
    ? 'var(--text-secondary)'
    : rvol >= 2
    ? 'var(--color-up)'
    : rvol <= 0.8
    ? 'var(--color-down)'
    : 'var(--accent-blue-light)';

  const catalystParts = [];
  if (insiderCount > 0) catalystParts.push(`${insiderCount} insider trade${insiderCount === 1 ? '' : 's'}`);
  if (!isCanadian && filingCount > 0) catalystParts.push(`${filingCount} ownership filing${filingCount === 1 ? '' : 's'}`);
  const catalystLabel = catalystParts.length > 0 ? catalystParts.join(' • ') : 'No major ownership events';

  const earningsDate = nextEarningsDate ? new Date(nextEarningsDate) : null;
  const earningsLabel = !earningsDate || Number.isNaN(earningsDate.getTime())
    ? isCanadian
      ? 'No earnings calendar feed'
      : 'No upcoming earnings found'
    : `Earnings ${earningsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const trendDetail = latestClose && sma20 && sma50
    ? `20DMA is the average closing price over 20 trading days, and 50DMA is the same over 50 days. Price at ${formatPrice(latestClose, currency)} is ${latestClose > sma20 ? 'above' : 'below'} the 20-day average and ${latestClose > sma50 ? 'above' : 'below'} the 50-day average.`
    : '20DMA and 50DMA are average closing prices over the last 20 and 50 trading days. They help show whether price is above or below its recent trend.';
  const participationDetail = rvol != null
    ? `Participation means how much volume showed up behind the move. ${rvol.toFixed(2)}x relative volume means today traded at ${rvol.toFixed(2)} times the recent 20-day average pace.`
    : 'Participation means how much trading volume is backing the move. Higher relative volume usually means more conviction behind the price action.';

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2" style={{ marginBottom: 14 }}>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Signal Summary
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Quick read on trend, participation, and ownership activity for {symbol}
          </p>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {latestVolume && averageVolume
            ? `${formatVolume(latestVolume)} vs ${formatVolume(averageVolume)} avg`
            : `Volume context in ${currency}`}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SignalPill
          label="Trend"
          value={trendLabel}
          tone={trendTone}
          detail={trendDetail}
        />
        <SignalPill
          label="Participation"
          value={participationLabel}
          tone={participationTone}
          detail={participationDetail}
        />
        <SignalPill
          label="Catalyst"
          value={catalystLabel}
          tone="var(--accent-blue-light)"
          detail={isCanadian ? 'Includes insider activity and chart markers' : 'Includes insider trades and 13D / 13G filings'}
        />
        <SignalPill
          label="Event Risk"
          value={earningsLabel}
          tone="var(--text-primary)"
          detail={isCanadian ? 'Canadian calendar support is limited' : 'Upcoming earnings can overpower technical setups'}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 14,
        }}
      >
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Signal Evidence
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <SignalTableHeader label="Metric" />
                <SignalTableHeader label="Value" />
                <SignalTableHeader label="Read" />
              </tr>
            </thead>
            <tbody>
              <SignalTableRow
                metric="Current price"
                value={latestClose != null ? formatPrice(latestClose, currency) : '—'}
                read="Latest close on the chart"
              />
              <SignalTableRow
                metric="20-day average"
                value={sma20 != null ? formatPrice(sma20, currency) : '—'}
                read={priceVs20 != null ? `${formatSignedPercent(priceVs20)} vs 20-day trend` : 'Need 20 trading days'}
              />
              <SignalTableRow
                metric="50-day average"
                value={sma50 != null ? formatPrice(sma50, currency) : '—'}
                read={priceVs50 != null ? `${formatSignedPercent(priceVs50)} vs 50-day trend` : 'Need 50 trading days'}
              />
              <SignalTableRow
                metric="Trend structure"
                value={trendLabel}
                read={dmaStack}
              />
              <SignalTableRow
                metric="Relative volume"
                value={rvol != null ? `${rvol.toFixed(2)}x` : '—'}
                read={rvol != null ? `${participationLabel} volume vs 20-day average` : 'Need more volume history'}
              />
              <SignalTableRow
                metric="Volume comparison"
                value={latestVolume && averageVolume ? `${formatVolume(latestVolume)} vs ${formatVolume(averageVolume)}` : '—'}
                read="Latest session volume versus the recent average"
              />
              <SignalTableRow
                metric="Ownership activity"
                value={catalystLabel}
                read={isCanadian ? 'Based on insider activity' : 'Combines insider trades and 13D/13G filings'}
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SignalTableHeader({ label }: { label: string }) {
  return (
    <th
      style={{
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        padding: '0 0 10px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {label}
    </th>
  );
}

function SignalTableRow({
  metric,
  value,
  read,
}: {
  metric: string;
  value: string;
  read: string;
}) {
  return (
    <tr>
      <td style={{ padding: '12px 8px 12px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
        {metric}
      </td>
      <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
        {value}
      </td>
      <td style={{ padding: '12px 0 12px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {read}
      </td>
    </tr>
  );
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function SignalPill({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: string;
  detail: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: tone }}>
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {detail}
      </p>
    </div>
  );
}

function RecentFilingsPanel({
  symbol,
  isCanadian,
  filings,
  loading,
  onOpenFiling,
}: {
  symbol: string;
  isCanadian: boolean;
  filings: MarketFiling[];
  loading: boolean;
  onOpenFiling: (filing: MarketFiling) => void;
}) {
  const recentFilings = filings.filter((filing) => filing?.filedDate).slice(0, 5);

  const formStyle = (formType: string) => {
    if (formType.startsWith('13D')) {
      return {
        bg: 'rgba(247,147,26,0.12)',
        color: '#F7931A',
        border: 'rgba(247,147,26,0.25)',
      };
    }
    return {
      bg: 'rgba(45,107,255,0.12)',
      color: 'var(--accent-blue-light)',
      border: 'rgba(45,107,255,0.25)',
    };
  };

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Recent 13D / 13G Filings
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
          Large-holder and activist ownership disclosures for {symbol}
        </p>
      </div>

      {isCanadian ? (
        <div style={{ padding: '6px 0 2px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
            Canadian ownership filings are reported on SEDAR+ rather than SEC EDGAR.
          </p>
          <a
            href={`https://www.sedarplus.ca/csa-party/party/search.html?lang=EN&company=${encodeURIComponent(symbol.replace('.TO', ''))}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: 'var(--accent-blue-light)', textDecoration: 'none' }}
          >
            Search this issuer on SEDAR+
          </a>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ width: 54, height: 20, borderRadius: 6, background: 'var(--bg-hover)', marginBottom: 8 }} className="animate-pulse" />
              <div style={{ width: '65%', height: 12, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 6 }} className="animate-pulse" />
              <div style={{ width: '40%', height: 10, borderRadius: 4, background: 'var(--bg-hover)' }} className="animate-pulse" />
            </div>
          ))}
        </div>
      ) : recentFilings.length === 0 ? (
        <div style={{ padding: '6px 0 2px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-tertiary)' }}>
            No recent 13D or 13G filings found for this stock.
          </p>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&type=SC+13&dateb=&owner=include&count=10`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: 'var(--accent-blue-light)', textDecoration: 'none' }}
          >
            Search EDGAR directly
          </a>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentFilings.map((filing, index) => {
              const style = formStyle(filing.formType);
              return (
                <button
                  key={filing.accessionNo || index}
                  onClick={() => onOpenFiling(filing)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    padding: 14,
                    borderRadius: 12,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: style.bg,
                      color: style.color,
                      border: `1px solid ${style.border}`,
                      fontFamily: "'Roboto Mono', monospace",
                      flexShrink: 0,
                    }}
                  >
                    {filing.formType}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {filing.filerName}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                      Filed {filing.filedDate}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>
            13D = activist or control intent. 13G = passive 5%+ ownership.
          </p>
        </>
      )}
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
    companyName?: string;
    price?: string; priceRaw?: number; change?: string; marketCap?: string;
    volume?: string; exchange?: string; insiders?: InsiderTransaction[];
    candles?: OHLCVBar[];
    news?: NewsItem[];
    fundamentals?: Record<string, unknown>;
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
      const history = messages.slice(-6).map((message) => ({
        role: message.role === 'ai' ? 'assistant' : 'user',
        content: message.text,
      }));
      const res = await fetch('/api/ask-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, symbol, context, history }),
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
