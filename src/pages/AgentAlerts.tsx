import { Bell } from 'lucide-react';
import { BriefingCard } from '../components/alerts/BriefingCard';
import { InsiderFilingsTable } from '../components/alerts/InsiderFilingsTable';
import { DataStatus } from '../components/ui/DataStatus';
import { useAgentInsiderFilings, useAgentLatestAlert } from '../hooks/useAgentAlerts';
import { useLeagueStore } from '../store/leagueStore';
import { useWatchlistStore } from '../store/watchlistStore';

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

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'blue' | 'amber';
}) {
  const palette =
    tone === 'blue'
      ? { border: 'rgba(45, 107, 255, 0.24)', color: 'var(--accent-blue-light)' }
      : tone === 'amber'
        ? { border: 'rgba(247, 147, 26, 0.24)', color: '#F7931A' }
        : { border: 'var(--border-subtle)', color: 'var(--text-primary)' };

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${palette.border}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <p style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: palette.color }}>
        {value}
      </p>
    </div>
  );
}

export default function AgentAlertsPage() {
  const playerId = useLeagueStore((state) => state.player?.id ?? null);
  const watchlistSymbols = useWatchlistStore((state) => state.items.map((item) => item.symbol.toUpperCase()));
  const latestAlert = useAgentLatestAlert(playerId);
  const insiderFilings = useAgentInsiderFilings(7);

  const isLoading = latestAlert.isLoading || insiderFilings.isLoading;
  const hasError = latestAlert.error || insiderFilings.error;
  const updatedAt = Math.max(latestAlert.dataUpdatedAt || 0, insiderFilings.dataUpdatedAt || 0);
  const note = latestAlert.data?.note ?? latestAlert.data?.error ?? insiderFilings.data?.error ?? null;
  const alert = latestAlert.data?.alert ?? null;
  const filings = insiderFilings.data?.filings ?? [];

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-8" style={{ background: 'var(--bg-primary)', minHeight: '100%' }}>
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Bell size={18} style={{ color: 'var(--accent-blue-light)' }} />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Alerts</h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', maxWidth: 720 }}>
            Personalized watchlist briefings and material insider filings, organized so you can scan what matters without reading the whole feed.
          </p>
        </div>
        <DataStatus
          updatedAt={updatedAt || null}
          refreshing={latestAlert.isFetching || insiderFilings.isFetching}
          source={latestAlert.data || insiderFilings.data ? 'live' : undefined}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <SummaryCard label="Briefing status" value={alert ? 'Live' : 'Waiting'} tone={alert ? 'blue' : 'neutral'} />
        <SummaryCard label="Watchlist names" value={String(watchlistSymbols.length)} tone="neutral" />
        <SummaryCard label="Filings in view" value={String(filings.length)} tone="amber" />
      </div>

      {note && !hasError && (
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
          <PlaceholderCard
            title="Loading briefing"
            body="Pulling the latest agent digest for your current watchlist."
          />
          <PlaceholderCard
            title="Loading insider filings"
            body="Recent material filings will land under the briefing with watchlist highlighting."
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
            Alerts are wired, but the feed could not be loaded right now.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Expected endpoints: <code>/api/alerts/latest</code> and <code>/api/alerts/insider-filings</code>
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-down)' }}>
            {((latestAlert.error || insiderFilings.error) as Error).message}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <BriefingCard alert={alert} />
          <InsiderFilingsTable filings={filings} watchlistSymbols={watchlistSymbols} />
        </div>
      )}
    </div>
  );
}
