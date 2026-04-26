import { useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { NewsCategory } from '../api/news';
import { ImpactCard } from '../components/news/ImpactCard';
import { FilterChips } from '../components/news/FilterChips';
import { DataStatus } from '../components/ui/DataStatus';
import { useNewsImpact } from '../hooks/useNewsImpact';

function ShellCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div
        style={{
          width: 120,
          height: 10,
          borderRadius: 999,
          background: 'var(--bg-elevated)',
          marginBottom: 12,
        }}
      />
      <div
        style={{
          width: '78%',
          height: 14,
          borderRadius: 999,
          background: 'var(--bg-elevated)',
          marginBottom: 10,
        }}
      />
      <div
        style={{
          width: '100%',
          height: 11,
          borderRadius: 999,
          background: 'var(--bg-elevated)',
          marginBottom: 8,
        }}
      />
      <div
        style={{
          width: '65%',
          height: 11,
          borderRadius: 999,
          background: 'var(--bg-elevated)',
          marginBottom: 14,
        }}
      />
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>{subtitle}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'hot';
}) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${tone === 'hot' ? 'rgba(246, 70, 93, 0.24)' : 'var(--border-subtle)'}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <p
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 700,
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: tone === 'hot' ? '#F6465D' : 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

function categoryLabel(category: NewsCategory | 'all') {
  switch (category) {
    case 'macro':
      return 'Macro';
    case 'sector':
      return 'Sector';
    case 'company':
      return 'Company';
    case 'policy':
      return 'Policy';
    case 'us_politics':
      return 'US Politics';
    case 'canada_macro':
      return 'Canada';
    case 'trade_policy':
      return 'Trade Policy';
    case 'geopolitical':
      return 'Geopolitical';
    default:
      return 'All';
  }
}

export default function NewsImpactPage() {
  const [category, setCategory] = useState<NewsCategory | 'all'>('all');
  const [showAllScores, setShowAllScores] = useState(false);
  const [days, setDays] = useState<1 | 7>(1);

  const {
    data,
    error,
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useNewsImpact({
    category,
    days,
    minScore: 7,
    all: showAllScores,
  });

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;
  const note = data?.note ?? data?.error ?? null;
  const items = data?.items ?? [];
  const highlightedCount = useMemo(() => items.filter((item) => item.impactScore >= 9).length, [items]);

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Newspaper size={18} style={{ color: 'var(--accent-blue-light)' }} />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>News Impact</h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', maxWidth: 720 }}>
            Market-moving headlines ranked by impact, with a default score floor so you can skim what actually matters first.
          </p>
        </div>
        <DataStatus
          updatedAt={generatedAt}
          refreshing={isFetching}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        <FilterChips value={category} onChange={setCategory} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { id: 1 as const, label: '24H' },
              { id: 7 as const, label: '7D' },
            ]).map((option) => {
              const active = days === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setDays(option.id)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                    background: active ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)',
                    color: active ? 'var(--accent-blue-light)' : 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setShowAllScores((current) => !current)}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: `1px solid ${showAllScores ? 'rgba(247, 147, 26, 0.4)' : 'var(--border-default)'}`,
              background: showAllScores ? 'rgba(247, 147, 26, 0.12)' : 'var(--bg-elevated)',
              color: showAllScores ? '#F7931A' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showAllScores ? 'Showing all scores' : 'Only 7+ impact'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <SummaryCard label="Stories in view" value={String(items.length)} tone="neutral" />
        <SummaryCard label="9-10 impact" value={String(highlightedCount)} tone="hot" />
        <SummaryCard label="Category" value={categoryLabel(category)} tone="neutral" />
      </div>

      {note && !error && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(247, 147, 26, 0.24)',
            borderRadius: 16,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {note}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ShellCard
            title="Loading ranked headlines"
            subtitle="Pulling the latest scored stories for the current filter set"
          />
          <ShellCard
            title="Applying score floor"
            subtitle="By default the feed leads with 7+ impact stories first"
          />
        </div>
      ) : error ? (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(246,70,93,0.25)',
            borderRadius: 18,
            padding: 18,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            News Impact is wired, but the feed could not be loaded right now.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoint: <code>/api/news/impact</code>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>
            {(error as Error).message}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 18,
            padding: 22,
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            No flagged stories for this view yet
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: 680 }}>
            This may just be the first run. Try widening the time window, switching categories, or dropping the 7+ score floor to inspect lower-conviction stories.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {items.map((item) => (
            <ImpactCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
