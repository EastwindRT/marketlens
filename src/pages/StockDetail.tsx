import { useParams } from 'react-router-dom';
import { Plus, Check, RefreshCw } from 'lucide-react';
import { useStockCandles, useStockQuote, useStockProfile } from '../hooks/useStockData';
import { useInsiderData } from '../hooks/useInsiderData';
import { useRealTimeQuote } from '../hooks/useRealTimeQuote';
import { useChartStore } from '../store/chartStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { StockChart } from '../components/chart/StockChart';
import { PriceDisplay } from '../components/ui/PriceDisplay';
import { TimeRangePicker } from '../components/ui/TimeRangePicker';
import { InsiderPanel } from '../components/insider/InsiderPanel';
import { TrendLinesLegend } from '../components/chart/TrendLines';
import { PriceHeaderSkeleton } from '../components/ui/LoadingSkeleton';
import { formatLargeNumber, formatVolume, formatPrice } from '../utils/formatters';
import { isTSXTicker } from '../utils/marketHours';

export default function StockDetail() {
  const { symbol = 'AAPL' } = useParams<{ symbol: string }>();

  const {
    timeRange, chartType, showSMA20, showSMA50, showVolume,
    setTimeRange, setChartType, toggleSMA20, toggleSMA50, toggleVolume,
  } = useChartStore();
  const { hasItem, addItem, removeItem } = useWatchlistStore();

  const { data: candles, isLoading: candlesLoading, error: candlesError, refetch: refetchCandles } = useStockCandles(symbol, timeRange);
  const { data: quote, isLoading: quoteLoading } = useStockQuote(symbol);
  const { data: profile, isLoading: profileLoading } = useStockProfile(symbol);
  const { data: insiders, isLoading: insidersLoading } = useInsiderData(symbol);
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

            {/* Watch button */}
            <button
              onClick={() => {
                if (inWatchlist) removeItem(symbol);
                else addItem({ symbol, name: profile?.name, exchange: profile?.exchange });
              }}
              className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-sm font-semibold flex-shrink-0 mt-1"
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
              {(['candlestick', 'line'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className="px-3 text-xs font-semibold capitalize"
                  style={{
                    height: 44,
                    background: chartType === type ? 'var(--bg-hover)' : 'transparent',
                    color: chartType === type ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 150ms ease-out',
                  }}
                >
                  {type === 'candlestick' ? 'Candle' : 'Line'}
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
        <StockChart
          data={candles || []}
          chartType={chartType}
          showSMA20={showSMA20}
          showSMA50={showSMA50}
          showVolume={showVolume}
          insiders={insiders || []}
          loading={candlesLoading}
          currency={currency}
          height={440}
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
      <div className="px-4 md:px-8 pb-10">
        <InsiderPanel
          transactions={insiders || []}
          candles={candles || []}
          loading={insidersLoading}
          error={null}
          currency={currency}
          isCanadian={isCanadian}
        />
      </div>
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
