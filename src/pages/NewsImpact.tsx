import { useQuery } from '@tanstack/react-query';
import { Newspaper } from 'lucide-react';
import { DataStatus } from '../components/ui/DataStatus';

type NewsImpactItem = {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  url: string | null;
  impactScore: number;
  category: string;
  summary: string;
  affectedTickers: string[];
};

type NewsImpactResponse = {
  schemaVersion: number;
  items: NewsImpactItem[];
  generatedAt: string;
};

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

export default function NewsImpactPage() {
  const {
    data,
    error,
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['news-impact-phase1'],
    queryFn: async (): Promise<NewsImpactResponse> => {
      const response = await fetch('/api/news/impact?minScore=7&days=1');
      if (!response.ok) {
        throw new Error(`News Impact endpoint returned ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).getTime() : dataUpdatedAt;

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Newspaper size={18} style={{ color: 'var(--accent-blue-light)' }} />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>News Impact</h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', maxWidth: 720 }}>
            Ranked market-moving headlines will live here once the scoring pipeline is online. Phase 1 is wiring only.
          </p>
        </div>
        <DataStatus
          updatedAt={generatedAt}
          refreshing={isFetching}
          source={data ? 'live' : undefined}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ShellCard
            title="Loading endpoint contract"
            subtitle="Proving route → endpoint wiring before ingestion is live"
          />
          <ShellCard
            title="Impact cards come next"
            subtitle="Category filters and score colours land in Phase 2"
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
            News Impact route is wired, but Claude’s Phase 1 endpoint is not live yet.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoint: <code>/api/news/impact</code>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>
            {(error as Error).message}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 18,
              padding: 18,
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Stub contract connected
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Schema version: <strong>{data?.schemaVersion ?? '—'}</strong> · Items returned: <strong>{data?.items.length ?? 0}</strong>
            </p>
          </div>
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 18,
              padding: 18,
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Phase 2 ready
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              The page is ready for scored items, category chips, ticker links, and the default score floor toggle.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
