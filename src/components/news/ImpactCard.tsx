import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NewsCategory, NewsItem } from '../../api/news';

const categoryLabels: Record<NewsCategory, string> = {
  macro: 'Macro',
  sector: 'Sector',
  company: 'Company',
  policy: 'Policy',
  us_politics: 'US Politics',
  canada_macro: 'Canada',
  trade_policy: 'Trade Policy',
  geopolitical: 'Geopolitical',
};

function scoreTone(score: number) {
  if (score >= 9) {
    return {
      border: 'rgba(246, 70, 93, 0.35)',
      badgeBg: 'rgba(246, 70, 93, 0.18)',
      badgeColor: '#F6465D',
      glow: '0 0 0 1px rgba(246, 70, 93, 0.08)',
    };
  }
  if (score >= 7) {
    return {
      border: 'rgba(247, 147, 26, 0.35)',
      badgeBg: 'rgba(247, 147, 26, 0.16)',
      badgeColor: '#F7931A',
      glow: '0 0 0 1px rgba(247, 147, 26, 0.08)',
    };
  }
  return {
    border: 'var(--border-subtle)',
    badgeBg: 'var(--bg-elevated)',
    badgeColor: 'var(--text-secondary)',
    glow: 'none',
  };
}

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface ImpactCardProps {
  item: NewsItem;
}

export function ImpactCard({ item }: ImpactCardProps) {
  const tone = scoreTone(item.impactScore);

  return (
    <article
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${tone.border}`,
        borderRadius: 18,
        padding: 18,
        boxShadow: tone.glow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 42,
              padding: '6px 10px',
              borderRadius: 999,
              background: tone.badgeBg,
              color: tone.badgeColor,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {item.impactScore}/10
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 10px',
              borderRadius: 999,
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {categoryLabels[item.category]}
          </span>
        </div>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--text-secondary)',
              fontSize: 12,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      <h2 style={{ margin: '0 0 10px', fontSize: 17, lineHeight: 1.35, color: 'var(--text-primary)' }}>
        {item.headline}
      </h2>

      <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        {item.summary}
      </p>

      {item.affectedTickers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {item.affectedTickers.map((ticker) => (
            <Link
              key={ticker}
              to={`/stock/${ticker}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 10px',
                borderRadius: 999,
                background: 'rgba(45, 107, 255, 0.12)',
                color: 'var(--accent-blue-light)',
                border: '1px solid rgba(45, 107, 255, 0.24)',
                fontSize: 12,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              {ticker}
            </Link>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {item.source}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {formatPublishedAt(item.publishedAt)}
        </span>
      </div>
    </article>
  );
}
