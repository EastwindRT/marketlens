import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { DataStatus } from '../components/ui/DataStatus';

type AlertBriefing = {
  id: string;
  createdAt: string;
  bullets: string[];
  sourceNewsIds: string[];
  sourceFilings: Array<{
    ticker: string;
    insiderName: string;
    type: 'BUY' | 'SELL';
    amount: number;
    filedDate: string;
    accessionNo: string;
  }>;
  watchlistSnapshot: string[];
};

type AlertResponse = {
  schemaVersion: number;
  alert: AlertBriefing | null;
};

type InsiderFilingsResponse = {
  schemaVersion: number;
  filings: Array<{
    ticker: string;
    insiderName: string;
    type: 'BUY' | 'SELL';
    amount: number;
    filedDate: string;
    accessionNo: string;
  }>;
};

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ width: 110, height: 10, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 12 }} />
      <div style={{ width: '82%', height: 13, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 10 }} />
      <div style={{ width: '68%', height: 13, borderRadius: 999, background: 'var(--bg-elevated)', marginBottom: 14 }} />
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</p>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>{body}</p>
    </div>
  );
}

export default function AgentAlertsPage() {
  const latestAlert = useQuery({
    queryKey: ['agent-alerts-phase1', 'latest'],
    queryFn: async (): Promise<AlertResponse> => {
      const response = await fetch('/api/alerts/latest');
      if (!response.ok) {
        throw new Error(`Alerts endpoint returned ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const insiderFilings = useQuery({
    queryKey: ['agent-alerts-phase1', 'filings'],
    queryFn: async (): Promise<InsiderFilingsResponse> => {
      const response = await fetch('/api/alerts/insider-filings?days=7');
      if (!response.ok) {
        throw new Error(`Insider filings endpoint returned ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const isLoading = latestAlert.isLoading || insiderFilings.isLoading;
  const hasError = latestAlert.error || insiderFilings.error;
  const updatedAt = Math.max(latestAlert.dataUpdatedAt || 0, insiderFilings.dataUpdatedAt || 0);

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Bell size={18} style={{ color: 'var(--accent-blue-light)' }} />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Alerts</h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', maxWidth: 720 }}>
            Personalized watchlist briefings and material insider filing alerts will surface here. Phase 1 is route and contract wiring only.
          </p>
        </div>
        <DataStatus
          updatedAt={updatedAt || null}
          refreshing={latestAlert.isFetching || insiderFilings.isFetching}
          source={latestAlert.data || insiderFilings.data ? 'live' : undefined}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <PlaceholderCard
            title="Loading briefing endpoint"
            body="The shell is proving the alerts route can talk to Claude’s stub contract."
          />
          <PlaceholderCard
            title="Filings table comes next"
            body="Watchlist highlighting and responsive insider rows land in Phase 3."
          />
        </div>
      ) : hasError ? (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(246,70,93,0.25)',
            borderRadius: 18,
            padding: 18,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Alerts route is wired, but the Phase 1 stub endpoints are not live yet.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoints: <code>/api/alerts/latest</code> and <code>/api/alerts/insider-filings</code>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>
            {((latestAlert.error || insiderFilings.error) as Error).message}
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
              Briefing contract connected
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Schema version: <strong>{latestAlert.data?.schemaVersion ?? '—'}</strong> · Latest alert present: <strong>{latestAlert.data?.alert ? 'yes' : 'no'}</strong>
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
              Insider filings contract connected
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Schema version: <strong>{insiderFilings.data?.schemaVersion ?? '—'}</strong> · Rows returned: <strong>{insiderFilings.data?.filings.length ?? 0}</strong>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
