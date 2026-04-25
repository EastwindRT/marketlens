import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, RotateCcw, LogOut, Shield, Activity, Search as SearchIcon } from 'lucide-react';
import {
  getAllPlayers,
  getPlayerTrades,
  adminResetPlayer,
  adminResetAll,
  adminDeletePlayer,
  adminUndoTrade,
  getRecentSearchLogs,
} from '../api/supabase';
import type { Player, Trade, SearchLog } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';

const ADMIN_EMAILS: string[] = (import.meta.env.VITE_ADMIN_EMAILS ?? 'renjith914@gmail.com')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

function formatRelativeTime(timestamp?: string | null): string {
  if (!timestamp) return 'Never';
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function isPlayerOnline(player: Player): boolean {
  if (!player.last_active_at) return false;
  return Date.now() - new Date(player.last_active_at).getTime() <= ONLINE_WINDOW_MS;
}

function ConfirmDialog({
  message, onConfirm, onCancel,
}: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-panel)', padding: 24, borderRadius: 12,
        maxWidth: 360, width: '90%', border: '1px solid var(--border)',
      }}>
        <p style={{ marginBottom: 20, color: 'var(--text-primary)' }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '8px 14px', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '8px 14px', background: 'var(--danger)',
            border: 'none', borderRadius: 6, color: '#fff',
          }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function PlayerAdminRow({
  player, onChanged,
}: { player: Player; onChanged: () => void }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [showTrades, setShowTrades] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);
  const [confirmTrade, setConfirmTrade] = useState<Trade | null>(null);

  const loadTrades = useCallback(async () => {
    const t = await getPlayerTrades(player.id);
    setTrades(t);
  }, [player.id]);

  useEffect(() => {
    if (showTrades && !trades) void loadTrades();
  }, [showTrades, trades, loadTrades]);

  async function handleReset() {
    await adminResetPlayer(player.id);
    setConfirm(null);
    onChanged();
  }

  async function handleDelete() {
    await adminDeletePlayer(player.id);
    setConfirm(null);
    onChanged();
  }

  async function handleUndo(trade: Trade) {
    await adminUndoTrade(trade);
    setConfirmTrade(null);
    await loadTrades();
    onChanged();
  }

  return (
    <div style={{
      padding: 14, border: '1px solid var(--border)', borderRadius: 8,
      marginBottom: 10, background: 'var(--bg-panel)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {player.display_name || player.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {player.google_email || '—'}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: isPlayerOnline(player) ? 'var(--success)' : 'var(--text-tertiary)' }}>
            {isPlayerOnline(player) ? 'Online now' : `Last active ${formatRelativeTime(player.last_active_at)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowTrades((v) => !v)} style={{
            padding: '6px 10px', fontSize: 12, background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)',
          }}>{showTrades ? 'Hide' : 'Trades'}</button>
          <button onClick={() => setConfirm('reset')} title="Reset holdings + trades" style={{
            padding: '6px 10px', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 6, color: 'var(--warning)',
          }}><RotateCcw size={14} /></button>
          <button onClick={() => setConfirm('delete')} title="Delete player" style={{
            padding: '6px 10px', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 6, color: 'var(--danger)',
          }}><Trash2 size={14} /></button>
        </div>
      </div>

      {showTrades && trades && (
        <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
          {trades.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No trades</div>
          ) : trades.map((t) => (
            <div key={t.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 0', borderBottom: '1px solid var(--border)',
              fontSize: 12,
            }}>
              <span style={{ color: t.trade_type === 'BUY' ? 'var(--success)' : 'var(--danger)' }}>
                {t.trade_type} {t.shares} {t.symbol} @ ${t.price.toFixed(2)}
              </span>
              <button onClick={() => setConfirmTrade(t)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', fontSize: 11,
              }}>Undo</button>
            </div>
          ))}
        </div>
      )}

      {confirm === 'reset' && (
        <ConfirmDialog
          message={`Reset ${player.name}? Clears all trades and holdings.`}
          onConfirm={handleReset}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          message={`Delete ${player.name} permanently? Their trades, holdings, and watchlist are removed.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirmTrade && (
        <ConfirmDialog
          message={`Undo ${confirmTrade.trade_type} of ${confirmTrade.shares} ${confirmTrade.symbol}?`}
          onConfirm={() => handleUndo(confirmTrade)}
          onCancel={() => setConfirmTrade(null)}
        />
      )}
    </div>
  );
}

function SearchLogTable({ logs }: { logs: SearchLog[] }) {
  if (logs.length === 0) {
    return (
      <div style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No search activity logged yet.
      </div>
    );
  }

  return (
    <>
      {logs.slice(0, 40).map((log, index) => (
        <div
          key={log.id}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(140px, 1fr) minmax(140px, 0.9fr) auto',
            gap: 10,
            padding: '12px 14px',
            borderBottom: index < Math.min(logs.length, 40) - 1 ? '1px solid var(--border)' : 'none',
            fontSize: 12,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{log.player_name || 'Unknown'}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{log.player_email || 'No email'}</div>
          </div>
          <div style={{ color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
            {log.query}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {log.selected_symbol ? `Opened ${log.selected_symbol}` : 'Search only'}
          </div>
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'right' }}>
            {formatRelativeTime(log.created_at)}
          </div>
        </div>
      ))}
    </>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const sessionPlayer = useLeagueStore((s) => s.player);
  const [players, setPlayers] = useState<Player[]>([]);
  const [searchLogs, setSearchLogs] = useState<SearchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, recentSearches] = await Promise.all([
        getAllPlayers(),
        getRecentSearchLogs(80),
      ]);
      setPlayers(all);
      setSearchLogs(recentSearches);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const isAdmin = isAdminEmail(sessionPlayer?.google_email);
  const onlineCount = players.filter(isPlayerOnline).length;

  if (!sessionPlayer) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 40, textAlign: 'center' }}>
        <Shield size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
        <p style={{ color: 'var(--text-secondary)' }}>Sign in to access admin.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 40, textAlign: 'center' }}>
        <Shield size={48} style={{ color: 'var(--danger)', marginBottom: 12 }} />
        <h2 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Not authorized</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {sessionPlayer.google_email} is not on the admin allow-list.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            marginTop: 20, padding: '8px 16px',
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}
        >Back to dashboard</button>
      </div>
    );
  }

  async function handleResetAll() {
    await adminResetAll();
    setConfirmResetAll(false);
    await load();
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 0',
      }}>
        <div>
          <h1 style={{ fontSize: 20, color: 'var(--text-primary)', margin: 0 }}>Admin</h1>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Signed in as {sessionPlayer.google_email}
          </div>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '8px 12px', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center',
          }}
        ><LogOut size={14} /> Exit</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setConfirmResetAll(true)}
          style={{
            width: '100%', padding: '10px 14px', background: 'transparent',
            border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)',
            cursor: 'pointer', fontSize: 13,
          }}
        >Reset ALL players (wipe trades + holdings)</button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
            <Activity size={14} />
            Active now
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{onlineCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Seen in the last 5 minutes</div>
        </div>

        <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
            <SearchIcon size={14} />
            Recent searches
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{searchLogs.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Latest terms captured in-app</div>
        </div>
      </div>

      <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Players ({players.length})
      </h2>

      {loading ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Loading...</div>
      ) : players.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No players yet.</div>
      ) : (
        players.map((p) => (
          <PlayerAdminRow key={p.id} player={p} onChanged={load} />
        ))
      )}

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Recent Searches
        </h2>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-panel)' }}>
          <SearchLogTable logs={searchLogs} />
        </div>
      </div>

      {confirmResetAll && (
        <ConfirmDialog
          message="Reset ALL players? Every player's trades and holdings are wiped. This cannot be undone."
          onConfirm={handleResetAll}
          onCancel={() => setConfirmResetAll(false)}
        />
      )}
    </div>
  );
}
