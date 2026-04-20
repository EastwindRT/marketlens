import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, RotateCcw, LogOut, Shield } from 'lucide-react';
import {
  getAllPlayers, getPlayerTrades,
  adminResetPlayer, adminResetAll, adminDeletePlayer, adminUndoTrade,
} from '../api/supabase';
import type { Player, Trade } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';

// ─── Admin allow-list — set VITE_ADMIN_EMAILS in .env (comma separated) ─────
const ADMIN_EMAILS: string[] = (import.meta.env.VITE_ADMIN_EMAILS ?? 'renjith914@gmail.com')
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ─── Generic confirm ────────────────────────────────────────────────────────
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

// ─── Player row ─────────────────────────────────────────────────────────────
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {player.display_name || player.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {player.google_email || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowTrades(v => !v)} style={{
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
          ) : trades.map(t => (
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

// ─── Main Admin page ────────────────────────────────────────────────────────
export default function Admin() {
  const navigate = useNavigate();
  const sessionPlayer = useLeagueStore((s) => s.player);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getAllPlayers();
    setPlayers(all);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isAdmin = isAdminEmail(sessionPlayer?.google_email);

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
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 40 }}>
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

      <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Players ({players.length})
      </h2>

      {loading ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
      ) : players.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No players yet.</div>
      ) : (
        players.map(p => (
          <PlayerAdminRow key={p.id} player={p} onChanged={load} />
        ))
      )}

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
