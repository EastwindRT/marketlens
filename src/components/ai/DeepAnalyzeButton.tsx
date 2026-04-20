import { Sparkles } from 'lucide-react';
import type { MouseEvent } from 'react';

interface Props {
  onClick: () => void;
  variant?: 'full' | 'compact' | 'icon';
  label?: string;
  title?: string;
}

/**
 * Dedicated trigger for the Deep Analyze (Claude) drawer.
 * - full:    big CTA used below Ask AI on StockDetail
 * - compact: small pill used inside sheets (e.g. FilingSheet)
 * - icon:    bare icon button used per-row (e.g. news list)
 */
export function DeepAnalyzeButton({ onClick, variant = 'full', label, title = 'Deep analyze with Claude' }: Props) {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(217,119,87,0.1)', border: '1px solid rgba(217,119,87,0.3)',
          color: '#D97757', cursor: 'pointer', flexShrink: 0,
          transition: 'background 150ms, border-color 150ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(217,119,87,0.18)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(217,119,87,0.1)'; }}
      >
        <Sparkles size={13} />
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={title}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 8,
          background: 'rgba(217,119,87,0.12)', border: '1px solid rgba(217,119,87,0.35)',
          color: '#D97757', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          transition: 'background 150ms, border-color 150ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(217,119,87,0.2)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(217,119,87,0.12)'; }}
      >
        <Sparkles size={12} />
        {label ?? 'Deep Analyze'}
      </button>
    );
  }

  // full
  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: '100%', padding: '13px 16px', borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(217,119,87,0.15), rgba(217,119,87,0.05))',
        border: '1px solid rgba(217,119,87,0.4)',
        color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        transition: 'border-color 150ms, background 150ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(217,119,87,0.65)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(217,119,87,0.4)'; }}
    >
      <Sparkles size={15} color="#D97757" />
      {label ?? 'Deep Analyze with Claude'}
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
        · Sonnet 4.5
      </span>
    </button>
  );
}
