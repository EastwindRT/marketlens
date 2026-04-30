import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ExternalLink, Newspaper } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NewsCategory } from '../api/news';
import { finnhub } from '../api/finnhub';
import type { CompanyProfile } from '../api/types';
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

function scoreTone(score: number) {
  if (score >= 9) {
    return {
      color: '#F6465D',
      background: 'rgba(246, 70, 93, 0.12)',
      border: 'rgba(246, 70, 93, 0.24)',
    };
  }
  if (score >= 7) {
    return {
      color: '#F7931A',
      background: 'rgba(247, 147, 26, 0.12)',
      border: 'rgba(247, 147, 26, 0.24)',
    };
  }
  return {
    color: 'var(--text-secondary)',
    background: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
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

export default function NewsImpactPage() {
  const [category, setCategory] = useState<NewsCategory | 'all'>('all');
  const [showAllScores, setShowAllScores] = useState(true);
  const [days, setDays] = useState<1 | 7>(1);
  const [sectorFilter, setSectorFilter] = useState('All sectors');

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

  const primaryTickers = useMemo(
    () => [...new Set(items.map((item) => item.affectedTickers[0]).filter(Boolean))] as string[],
    [items]
  );

  const profileQueries = useQueries({
    queries: primaryTickers.map((symbol) => ({
      queryKey: ['news-impact-profile', symbol],
      queryFn: async (): Promise<CompanyProfile | null> => {
        try {
          return await finnhub.getProfile(symbol);
        } catch {
          return null;
        }
      },
      staleTime: 6 * 60 * 60 * 1000,
      retry: 0,
      enabled: Boolean(symbol),
    })),
  });

  const sectorByTicker = useMemo(() => {
    const map = new Map<string, string | null>();
    primaryTickers.forEach((symbol, index) => {
      map.set(symbol, profileQueries[index]?.data?.finnhubIndustry || null);
    });
    return map;
  }, [primaryTickers, profileQueries]);

  const enrichedItems = useMemo(() => {
    return items.map((item) => {
      const primaryTicker = item.affectedTickers[0] || null;
      const sector = primaryTicker ? sectorByTicker.get(primaryTicker) || null : null;
      return {
        ...item,
        primaryTicker,
        sector,
      };
    });
  }, [items, sectorByTicker]);

  const sectorOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of enrichedItems) {
      if (item.sector) values.add(item.sector);
      else if (item.affectedTickers.length > 0) values.add('Unknown sector');
    }
    return ['All sectors', ...[...values].sort((a, b) => a.localeCompare(b))];
  }, [enrichedItems]);

  const filteredItems = useMemo(() => {
    if (sectorFilter === 'All sectors') return enrichedItems;
    return enrichedItems.filter((item) => {
      const label = item.sector || (item.affectedTickers.length > 0 ? 'Unknown sector' : null);
      return label === sectorFilter;
    });
  }, [enrichedItems, sectorFilter]);

  const highlightedCount = useMemo(
    () => filteredItems.filter((item) => item.impactScore >= 9).length,
    [filteredItems]
  );

  return (
    <div className="px-3 sm:px-4 md:px-8 pt-4 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 14 }}>
        <div className="flex items-center gap-2">
          <Newspaper size={18} style={{ color: 'var(--accent-blue-light)' }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>News</h1>
        </div>
        <DataStatus updatedAt={generatedAt} refreshing={isFetching} />
      </div>

      {/* Description — desktop only */}
      <p className="hidden md:block" style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: 720 }}>
        Market-moving headlines scored by impact, with category and sector filters.
      </p>

      {/* Filter chips */}
      <div style={{ marginBottom: 10 }}>
        <FilterChips value={category} onChange={setCategory} />
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        {([{ id: 1 as const, label: '24H' }, { id: 7 as const, label: '7D' }]).map((option) => {
          const active = days === option.id;
          return (
            <button key={option.id} onClick={() => setDays(option.id)} style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`, background: active ? 'rgba(45, 107, 255, 0.14)' : 'var(--bg-elevated)', color: active ? 'var(--accent-blue-light)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {option.label}
            </button>
          );
        })}

        <button
          onClick={() => setShowAllScores((c) => !c)}
          style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${showAllScores ? 'rgba(247,147,26,0.4)' : 'var(--border-default)'}`, background: showAllScores ? 'rgba(247,147,26,0.12)' : 'var(--bg-elevated)', color: showAllScores ? '#F7931A' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {showAllScores ? 'All scores' : '7+ only'}
        </button>

        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          style={{ flex: '1 1 180px', minWidth: 160, maxWidth: 260, padding: '7px 10px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}
        >
          {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Stats strip — compact on mobile, full cards on desktop */}
      <div className="md:hidden" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>Stories</p>
          <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{filteredItems.length}</p>
        </div>
        <div style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid rgba(246,70,93,0.24)', borderRadius: 12, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>9-10 Impact</p>
          <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800, color: '#F6465D' }}>{highlightedCount}</p>
        </div>
      </div>

      <div
        className="hidden md:grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}
      >
        <SummaryCard label="Stories in view" value={String(filteredItems.length)} tone="neutral" />
        <SummaryCard label="9-10 impact" value={String(highlightedCount)} tone="hot" />
        <SummaryCard label="Category" value={categoryLabel(category)} tone="neutral" />
        <SummaryCard label="Sector" value={sectorFilter} tone="neutral" />
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
            News is wired, but the feed could not be loaded right now.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoint: <code>/api/news/impact</code>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>
            {(error as Error).message}
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
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
            This may just be the first run. Try widening the time window, switching categories, changing the sector filter, or dropping the 7+ score floor to inspect lower-conviction stories.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 18,
            overflow: 'hidden',
          }}
        >
          {/* Desktop table */}
          <div className="hidden md:block">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.8fr) 100px 140px 120px',
                gap: 12,
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
              }}
            >
              <span>Headline</span>
              <span>Impact</span>
              <span>Sector</span>
              <span>Time</span>
            </div>

            {filteredItems.map((item) => {
              const tone = scoreTone(item.impactScore);
              const sector = item.sector || (item.affectedTickers.length > 0 ? 'Unknown sector' : 'Market-wide');
              return (
                <article
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.8fr) 100px 140px 120px',
                    gap: 12,
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    alignItems: 'start',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ marginBottom: 5 }}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14, fontWeight: 700, lineHeight: 1.45, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span>{item.headline}</span>
                          <ExternalLink size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, lineHeight: 1.45 }}>{item.headline}</span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{item.summary}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{item.source}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>·</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{categoryLabel(item.category)}</span>
                      {item.affectedTickers.length > 0 && (
                        <>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>·</span>
                          {item.affectedTickers.map((ticker) => (
                            <Link key={ticker} to={`/stock/${ticker}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 7px', borderRadius: 999, background: 'rgba(45, 107, 255, 0.10)', color: 'var(--accent-blue-light)', border: '1px solid rgba(45, 107, 255, 0.22)', textDecoration: 'none', fontSize: 11, fontWeight: 700 }}>
                              {ticker}
                            </Link>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 50, padding: '5px 9px', borderRadius: 999, background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 12, fontWeight: 800 }}>
                      {item.impactScore}/10
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{sector}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{formatPublishedAt(item.publishedAt)}</div>
                </article>
              );
            })}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden">
            {filteredItems.map((item) => {
              const tone = scoreTone(item.impactScore);
              const sector = item.sector || (item.affectedTickers.length > 0 ? 'Unknown sector' : 'Market-wide');
              return (
                <article key={item.id} style={{ padding: '13px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                  {/* Score badge + headline */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, minWidth: 0 }}>
                    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, padding: '4px 7px', borderRadius: 8, background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 800 }}>
                      {item.impactScore}/10
                    </span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {item.source} · {formatPublishedAt(item.publishedAt)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'none' }}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
                          {item.headline} <ExternalLink size={10} style={{ color: 'var(--text-tertiary)', display: 'inline', verticalAlign: 'middle' }} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{item.headline}</span>
                      )}
                    </div>
                  </div>

                  {/* Summary — capped at 2 lines */}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14, fontWeight: 750, lineHeight: 1.38, display: 'block' }}>
                      {item.headline} <ExternalLink size={10} style={{ color: 'var(--text-tertiary)', display: 'inline', verticalAlign: 'middle' }} />
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 750, lineHeight: 1.38, display: 'block' }}>{item.headline}</span>
                  )}

                  {item.summary && (
                    <p style={{ margin: '7px 0 8px', fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.summary}
                    </p>
                  )}

                  {/* Meta row */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 6px', alignItems: 'center' }}>
                    <span style={{ padding: '2px 7px', borderRadius: 999, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {categoryLabel(item.category)}
                    </span>
                    <span style={{ padding: '2px 7px', borderRadius: 999, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {sector}
                    </span>
                    {item.affectedTickers.slice(0, 4).map((ticker) => (
                      <Link key={ticker} to={`/stock/${ticker}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 999, background: 'rgba(45,107,255,0.10)', color: 'var(--accent-blue-light)', border: '1px solid rgba(45,107,255,0.22)', textDecoration: 'none', fontSize: 11, fontWeight: 700 }}>
                        {ticker}
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
