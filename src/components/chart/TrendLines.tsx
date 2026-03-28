interface TrendLinesLegendProps {
  showSMA20: boolean;
  showSMA50: boolean;
  onToggleSMA20: () => void;
  onToggleSMA50: () => void;
}

export function TrendLinesLegend({ showSMA20, showSMA50, onToggleSMA20, onToggleSMA50 }: TrendLinesLegendProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggleSMA20}
        className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
        style={{
          color: showSMA20 ? '#F59E0B' : 'var(--text-tertiary)',
          background: showSMA20 ? 'rgba(245,158,11,0.12)' : 'transparent',
          border: `1px solid ${showSMA20 ? 'rgba(245,158,11,0.3)' : 'var(--border-subtle)'}`,
          cursor: 'pointer',
          transition: 'all 150ms ease-out',
        }}
      >
        <span style={{ width: 12, height: 2, display: 'inline-block', background: '#F59E0B', borderRadius: 1 }} />
        SMA 20
      </button>
      <button
        onClick={onToggleSMA50}
        className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
        style={{
          color: showSMA50 ? '#A855F7' : 'var(--text-tertiary)',
          background: showSMA50 ? 'rgba(168,85,247,0.12)' : 'transparent',
          border: `1px solid ${showSMA50 ? 'rgba(168,85,247,0.3)' : 'var(--border-subtle)'}`,
          cursor: 'pointer',
          transition: 'all 150ms ease-out',
        }}
      >
        <span style={{ width: 12, height: 2, display: 'inline-block', background: '#A855F7', borderRadius: 1 }} />
        SMA 50
      </button>
    </div>
  );
}
