import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type AreaData,
  type HistogramData,
} from 'lightweight-charts';
import type { OHLCVBar } from '../../api/types';
import type { ChartType, InsiderTransaction } from '../../api/types';
import { calculateSMA } from '../../utils/indicators';
import { ChartSkeleton } from '../ui/LoadingSkeleton';
import { getInsiderType } from '../../hooks/useInsiderData';

interface StockChartProps {
  data: OHLCVBar[];
  chartType: ChartType;
  showSMA20: boolean;
  showSMA50: boolean;
  showVolume: boolean;
  insiders?: InsiderTransaction[];
  loading?: boolean;
  currency?: string;
  height?: number;
  onInsiderClick?: (transaction: InsiderTransaction) => void;
}

function compactValue(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Detect touch device
const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export function StockChart({
  data,
  chartType,
  showSMA20,
  showSMA50,
  showVolume,
  insiders = [],
  loading = false,
  height = 400,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);

  const initChart = useCallback(() => {
    if (!containerRef.current) return;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const touch = isTouchDevice();

    // Get actual container width. getBoundingClientRect() is reliable at useEffect time
    // since the div is already laid out.
    const containerWidth =
      containerRef.current.getBoundingClientRect().width ||
      containerRef.current.offsetWidth ||
      containerRef.current.clientWidth ||
      800;

    const chart = createChart(containerRef.current, {
      // Intentionally 1px narrower than true width so the forceRepaint resize below
      // is never a no-op (lightweight-charts skips resize when size is unchanged).
      width: Math.max(1, containerWidth - 1),
      height,
      layout: {
        background: { color: '#1C1917' },
        textColor: '#6B5F52',
        fontSize: 11,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255,240,220,0.03)' },
        horzLines: { color: 'rgba(255,240,220,0.04)' },
      },
      crosshair: {
        // Magnet on touch: snaps to nearest candle instead of floating freely
        mode: touch ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(217,119,87,0.4)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#D97757',
        },
        horzLine: {
          color: 'rgba(217,119,87,0.4)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#D97757',
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.22 : 0.1 },
        textColor: '#6B5F52',
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        tickMarkMaxCharacterLength: 8,
      },
      // On touch: disable scroll/scale so the chart doesn't fight page scroll.
      // The user taps to see crosshair; they scroll the page by dragging outside the chart.
      handleScroll: touch ? false : { mouseWheel: true, pressedMouseMove: true },
      handleScale: touch ? false : { mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // ── Price series ───────────────────────────────────────────────────────
    if (chartType === 'area') {
      // Claude-style warm coral gradient fill
      const areaSeries = chart.addAreaSeries({
        lineColor: '#D97757',
        lineWidth: 2,
        topColor: 'rgba(217, 119, 87, 0.28)',
        bottomColor: 'rgba(217, 119, 87, 0.0)',
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: '#D97757',
        crosshairMarkerBackgroundColor: '#1C1917',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      areaSeriesRef.current = areaSeries;

      if (data.length > 0) {
        areaSeries.setData(
          data.map(bar => ({ time: bar.time as any, value: bar.close })) as AreaData[]
        );
      }
    } else if (chartType === 'candlestick') {
      const candleSeries = chart.addCandlestickSeries({
        upColor:         'transparent',
        borderUpColor:   '#4CAF82',
        wickUpColor:     '#4CAF82',
        downColor:       'rgba(224, 92, 106, 0.65)',
        borderDownColor: '#E05C6A',
        wickDownColor:   '#E05C6A',
        borderVisible:   true,
        wickVisible:     true,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      candleSeriesRef.current = candleSeries;

      if (data.length > 0) {
        candleSeries.setData(
          data.map(bar => ({
            time: bar.time as any,
            open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          })) as CandlestickData[]
        );
      }
    } else {
      // Plain line
      const lineSeries = chart.addLineSeries({
        color: '#D97757',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: '#D97757',
        crosshairMarkerBackgroundColor: '#1C1917',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      lineSeriesRef.current = lineSeries;

      if (data.length > 0) {
        lineSeries.setData(
          data.map(bar => ({ time: bar.time as any, value: bar.close })) as LineData[]
        );
      }
    }

    // ── Volume bars ───────────────────────────────────────────────────────
    if (showVolume && data.length > 0) {
      const volumeSeries = chart.addHistogramSeries({
        color: '#D97757',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.84, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;

      volumeSeries.setData(
        data.map(bar => ({
          time: bar.time as any,
          value: bar.volume,
          color: bar.close >= bar.open
            ? 'rgba(76, 175, 130, 0.2)'
            : 'rgba(224, 92, 106, 0.2)',
        })) as HistogramData[]
      );
    }

    // ── SMA overlays ──────────────────────────────────────────────────────
    if (showSMA20 && data.length > 20) {
      const sma20 = chart.addLineSeries({
        color: 'rgba(245, 158, 11, 0.6)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: 'SMA20',
      });
      sma20Ref.current = sma20;
      sma20.setData(calculateSMA(data, 20).map(d => ({ time: d.time as any, value: d.value })));
    }

    if (showSMA50 && data.length > 50) {
      const sma50 = chart.addLineSeries({
        color: 'rgba(168, 85, 247, 0.6)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: 'SMA50',
      });
      sma50Ref.current = sma50;
      sma50.setData(calculateSMA(data, 50).map(d => ({ time: d.time as any, value: d.value })));
    }

    // ── Insider markers — grouped by date ─────────────────────────────────
    const primarySeries = areaSeriesRef.current || candleSeriesRef.current || lineSeriesRef.current;
    if (insiders.length > 0 && primarySeries) {
      const byDate = new Map<string, { buys: InsiderTransaction[]; sells: InsiderTransaction[]; grants: InsiderTransaction[]; taxSells: InsiderTransaction[] }>();
      insiders
        .filter(t => t.transactionDate && t.transactionPrice > 0)
        .forEach(t => {
          const date = t.transactionDate.slice(0, 10);
          if (!byDate.has(date)) byDate.set(date, { buys: [], sells: [], grants: [], taxSells: [] });
          const group = byDate.get(date)!;
          const type = getInsiderType(t.transactionCode, t.change);
          if (type === 'BUY') group.buys.push(t);
          else if (type === 'GRANT') group.grants.push(t);
          else if (type === 'TAX_SELL') group.taxSells.push(t);
          else group.sells.push(t);
        });

      const markers: any[] = [];
      byDate.forEach(({ buys, sells, grants, taxSells }, date) => {
        if (buys.length > 0) {
          markers.push({
            time: date,
            position: 'belowBar',
            color: 'rgba(5,177,105,0.7)',
            shape: 'circle',
            text: '',
            size: 1,
          });
        }
        if (grants.length > 0) {
          markers.push({
            time: date,
            position: 'belowBar',
            color: 'rgba(45,107,255,0.6)',
            shape: 'circle',
            text: '',
            size: 1,
          });
        }
        if (sells.length > 0) {
          markers.push({
            time: date,
            position: 'aboveBar',
            color: 'rgba(246,70,93,0.7)',
            shape: 'circle',
            text: '',
            size: 1,
          });
        }
        if (taxSells.length > 0) {
          markers.push({
            time: date,
            position: 'aboveBar',
            color: 'rgba(247,147,26,0.7)',
            shape: 'circle',
            text: '',
            size: 1,
          });
        }
      });

      if (markers.length > 0) {
        markers.sort((a, b) => a.time.localeCompare(b.time));
        primarySeries.setMarkers(markers);
      }
    }

    // Force a synchronous repaint immediately after chart creation.
    // lightweight-charts normally schedules canvas sizing via requestAnimationFrame,
    // but RAF is broken in MetaMask-injected browsers (SES lockdown). The forceRepaint=true
    // argument bypasses RAF and repaints synchronously right now.
    chart.resize(containerWidth, height, true);
    chart.timeScale().fitContent();

    const handleWindowResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      const w =
        containerRef.current.getBoundingClientRect().width ||
        containerRef.current.offsetWidth ||
        containerRef.current.clientWidth;
      if (w > 0) chartRef.current.resize(w, height, true);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [data, chartType, showSMA20, showSMA50, showVolume, insiders, height]);

  useEffect(() => {
    const cleanup = initChart();
    return () => {
      cleanup?.();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [initChart]);

  if (loading) return <ChartSkeleton />;

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{
        background: 'var(--bg-primary)',
        height,
        // Prevent browser scroll/zoom from fighting the chart's touch handlers
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overflow: 'hidden',
      }}
    />
  );
}
