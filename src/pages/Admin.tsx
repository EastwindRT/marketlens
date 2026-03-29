import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, RefreshCw, Trash2, RotateCcw, Activity,
  CheckCircle, XCircle, AlertTriangle, ChevronRight, DollarSign, History,
} from 'lucide-react';
import {
  getAllPlayers, getAllHoldings, getRecentTrades, getPlayerTrades, supabase,
  adminResetPlayer, adminResetAll, adminDeletePlayer, adminSetCash, adminUndoTrade,
} from '../api/supabase';
import type { Player, Holding, Trade } from '../api/supabase';

// ─── Admin PIN — set VITE_ADMIN_PIN in .env, default fallback ────────────────
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN ?? 'eastwind2025';
const ADMIN_NAME = 'eastwind';

// ─── Health check item ───────────────────────────────────────────────────────
interface HealthItem {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'loading';
  detail: string;
}

function HealthRow({ item }: { item: HealthItem }) {
  const icon =
    item.status === 'ok' ? <CheckCircle size={14} style={{ color: 'var(--color-up)' }} /> :
    item.status === 'warn' ? <AlertTriangle size={14} style={{ color: '#F0A716' }} /> :
    item.status === 'error' ? <XCircle size={14} style={{ color: 'var(--color-down)' }} /> :
    <RefreshCw size={14} style={{ color: 'var(--text-tertiary)', animation: 'spin 1s linear infinite' }} />;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.label}</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{item.detail}</span>
    </div>
  );
}

// ─── Confirm dialog ──────────────────────────────────────────────────────────
function ConfirmDialog({
  message, onConfirm, onCancel, danger = false,
}: { message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: '0 20px',
    }}>
      <div style={{
        background: 'var(--bg-elevated)', borderRadius: 16,
        border: '1px solid var(--border-default)',
        padding: '24px 20px', width: '100%', maxWidth: 360,
      }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px', textAlign: 'center' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: danger ? 'rgba(246,70,93,0.15)' : 'rgba(22,82,240,0.15)',
            border: `1px solid ${danger ? 'rgba(246,70,93,0.4)' : 'rgba(22,82,240,0.4)'}`,
            color: danger ? 'var(--color-down)' : 'var(--accent-blue)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cash editor ─────────────────────────────────────────────────────────────
function CashEditor({ player, onDone }: { player: Player; onDone: () => void }) {
  const [amount, setAmount] = useState(String(player.cash));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) { setErr('Enter a valid amount'); return; }
    setSaving(true);
    try {
      await adminSetCash(player.id, val);
      onDone();
    } catch { setErr('Failed to update cash'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: '0 20px',
    }}>
      <div style={{
        background: 'var(--bg-elevated)', borderRadius: 16,
        border: '1px solid var(--border-default)',
        padding: '24px 20px', width: '100%', maxWidth: 360,
      }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
          Set cash for {player.name}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
          Current: ${player.cash.toFixed(2)}
        </p>
        <input
          type="number" value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10, boxSizing: 'border-box',
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            color: 'var(--text-primary)', fontSize: 16, fontFamily: 'Roboto Mono, monospace',
            outline: 'none',
          }}
        />
        {err && <p style={{ fontSize: 12, color: 'var(--color-down)', margin: '8px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onDone} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: 'var(--accent-blue)', border: 'none',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Trade history + undo drawer ─────────────────────────────────────────────
function TradeHistoryDrawer({ player, onClose, onUndo }: {
  player: Player;
  onClose: () => void;
  onUndo: () => void;
}) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [confirmTrade, setConfirmTrade] = useState<Trade | null>(null);

  useEffect(() => {
    getPlayerTrades(player.id)
      .then(setTrades)
      .finally(() => setLoading(false));
  }, [player.id]);

  async function handleUndo(trade: Trade) {
    setUndoingId(trade.id);
    try {
      await adminUndoTrade(trade);
      setTrades(prev => prev.filter(t => t.id !== trade.id));
      onUndo();
    } catch {}
    finally { setUndoingId(null); setConfirmTrade(null); }
  }

  function getTimeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 200,
    }} onClick={onClose}>
      <div
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-elevated)',
          borderRadius: '20px 20px 0 0',
          border: '1px solid var(--border-default)',
          maxHeight: '75vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle + header */}
        <div style={{ padding: '12px 16px 0', textAlign: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--border-default)', margin: '0 auto 16px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{player.name}'s Trades</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{trades.length} trade{trades.length !== 1 ? 's' : ''} · tap Undo to reverse</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Trade list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {loading ? (
            [1,2,3].map(i => <div key={i} style={{ height: 52, margin: '6px 16px', borderRadius: 8, background: 'var(--bg-surface)' }} className="animate-pulse" />)
          ) : trades.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>No trades yet</div>
          ) : (
            trades.map(trade => {
              const isBuy = trade.trade_type === 'BUY';
              return (
                <div key={trade.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)',
                }}>
                  {/* Type badge */}
                  <div style={{
                    padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                    fontSize: 11, fontWeight: 700,
                    background: isBuy ? 'rgba(5,177,105,0.12)' : 'rgba(246,70,93,0.12)',
                    color: isBuy ? 'var(--color-up)' : 'var(--color-down)',
                  }}>
                    {trade.trade_type}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {trade.symbol} · {trade.shares} shares
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      ${trade.price.toFixed(2)} · ${trade.total.toLocaleString('en-CA', { maximumFractionDigits: 0 })} · {getTimeAgo(trade.traded_at)}
                    </div>
                  </div>

                  {/* Undo button */}
                  <button
                    onClick={() => setConfirmTrade(trade)}
                    disabled={undoingId === trade.id}
                    style={{
                      padding: '6px 12px', borderRadius: 8, flexShrink: 0,
                      background: 'rgba(240,167,22,0.1)', border: '1px solid rgba(240,167,22,0.25)',
                      color: '#F0A716', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      opacity: undoingId === trade.id ? 0.5 : 1,
                    }}
                  >
                    {undoingId === trade.id ? '…' : 'Undo'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {confirmTrade && (
        <ConfirmDialog
          message={`Undo ${confirmTrade.trade_type} of ${confirmTrade.shares} ${confirmTrade.symbol} ($${confirmTrade.total.toLocaleString('en-CA', { maximumFractionDigits: 0 })})? This reverses the cash and share changes.`}
          onConfirm={() => handleUndo(confirmTrade)}
          onCancel={() => setConfirmTrade(null)}
        />
      )}
    </div>
  );
}

// ─── Player row ──────────────────────────────────────────────────────────────
function PlayerAdminRow({
  player, holdings, onAction,
}: { player: Player; holdings: Holding[]; onAction: () => void }) {
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);
  const [editCash, setEditCash] = useState(false);
  const [showTrades, setShowTrades] = useState(false);
  const [busy, setBusy] = useState(false);

  const holdingsCount = holdings.filter(h => h.player_id === player.id).length;

  async function handleReset() {
    setBusy(true);
    try { await adminResetPlayer(player.id); onAction(); }
    catch { }
    finally { setBusy(false); setConfirm(null); }
  }

  async function handleDelete() {
    setBusy(true);
    try { await adminDeletePlayer(player.id); onAction(); }
    catch { }
    finally { setBusy(false); setConfirm(null); }
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 0', borderBottom: '1px solid var(--border-subtle)',
      }}>
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: player.avatar_color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>
          {player.name[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{player.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
            ${player.cash.toFixed(2)} cash · {holdingsCount} position{holdingsCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setShowTrades(true)}
            title="Trade history / undo"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <History size={13} />
          </button>
          <button
            onClick={() => setEditCash(true)}
            title="Set cash"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <DollarSign size={13} />
          </button>
          <button
            onClick={() => setConfirm('reset')}
            disabled={busy}
            title="Reset player"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#F0A716',
            }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={() => setConfirm('delete')}
            disabled={busy}
            title="Delete player"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(246,70,93,0.2)',
              background: 'rgba(246,70,93,0.06)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-down)',
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {confirm === 'reset' && (
        <ConfirmDialog
          message={`Reset ${player.name}? This clears all their trades and holdings and restores $1,000 cash.`}
          onConfirm={handleReset}
          onCancel={() => setConfirm(null)}
          danger
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          message={`Permanently delete ${player.name} and all their data? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirm(null)}
          danger
        />
      )}
      {editCash && (
        <CashEditor player={player} onDone={() => { setEditCash(false); onAction(); }} />
      )}
      {showTrades && (
        <TradeHistoryDrawer
          player={player}
          onClose={() => setShowTrades(false)}
          onUndo={onAction}
        />
      )}
    </>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────
function AdminLogin({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  function tryUnlock() {
    if (pin === ADMIN_PIN) {
      onUnlock();
    } else {
      setError('Incorrect PIN');
      setPin('');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 20px', background: 'var(--bg-primary)',
    }}>
      <div style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
          background: 'rgba(22,82,240,0.12)', border: '1px solid rgba(22,82,240,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={24} style={{ color: 'var(--accent-blue)' }} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Admin
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 24px' }}>
          {ADMIN_NAME} only
        </p>
        <input
          type="password"
          placeholder="Enter PIN"
          value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && tryUnlock()}
          autoFocus
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 12, boxSizing: 'border-box',
            background: 'var(--bg-surface)', border: `1px solid ${error ? 'var(--color-down)' : 'var(--border-default)'}`,
            color: 'var(--text-primary)', fontSize: 16, textAlign: 'center',
            letterSpacing: '0.2em', outline: 'none', marginBottom: 8,
          }}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--color-down)', margin: '0 0 12px' }}>{error}</p>}
        <button
          onClick={tryUnlock}
          style={{
            width: '100%', padding: '14px', borderRadius: 12, marginTop: 4,
            background: 'var(--accent-blue)', border: 'none',
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}

// ─── Main Admin page ──────────────────────────────────────────────────────────
export default function Admin() {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [tradeCount, setTradeCount] = useState(0);
  const [health, setHealth] = useState<HealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [busyResetAll, setBusyResetAll] = useState(false);
  const [tab, setTab] = useState<'players' | 'health'>('players');

  const load = useCallback(async () => {
    try {
      const [p, h, t] = await Promise.all([
        getAllPlayers(),
        getAllHoldings(),
        getRecentTrades(100),
      ]);
      setPlayers(p);
      setHoldings(h);
      setTradeCount(t.length);
    } catch {}
    finally { setLoading(false); }
  }, []);

  const runHealthCheck = useCallback(async () => {
    setHealth([
      { label: 'Supabase connection', status: 'loading', detail: 'Checking…' },
      { label: 'Finnhub API key', status: 'loading', detail: 'Checking…' },
      { label: 'Polygon API key', status: 'loading', detail: 'Checking…' },
      { label: 'Players table', status: 'loading', detail: 'Checking…' },
      { label: 'Holdings table', status: 'loading', detail: 'Checking…' },
      { label: 'Trades table', status: 'loading', detail: 'Checking…' },
    ]);

    // Test Supabase
    let supabaseOk = false;
    try {
      const { error } = await supabase.from('players').select('id').limit(1);
      supabaseOk = !error;
    } catch {}

    // API key checks (env presence only)
    const hasFinnhub = !!import.meta.env.VITE_FINNHUB_API_KEY;
    const hasPolygon = !!import.meta.env.VITE_POLYGON_API_KEY;

    // Table row counts
    let playerCount = 0, holdingCount = 0, tradeCountLocal = 0;
    try {
      const { count: pc } = await supabase.from('players').select('*', { count: 'exact', head: true });
      const { count: hc } = await supabase.from('holdings').select('*', { count: 'exact', head: true });
      const { count: tc } = await supabase.from('trades').select('*', { count: 'exact', head: true });
      playerCount = pc ?? 0;
      holdingCount = hc ?? 0;
      tradeCountLocal = tc ?? 0;
    } catch {}

    setHealth([
      {
        label: 'Supabase connection',
        status: supabaseOk ? 'ok' : 'error',
        detail: supabaseOk ? 'Connected' : 'Failed',
      },
      {
        label: 'Finnhub API key',
        status: hasFinnhub ? 'ok' : 'warn',
        detail: hasFinnhub ? 'Set' : 'Not set (demo mode)',
      },
      {
        label: 'Polygon API key',
        status: hasPolygon ? 'ok' : 'warn',
        detail: hasPolygon ? 'Set' : 'Not set (stub)',
      },
      {
        label: 'Players table',
        status: supabaseOk ? 'ok' : 'error',
        detail: supabaseOk ? `${playerCount} rows` : 'Unreachable',
      },
      {
        label: 'Holdings table',
        status: supabaseOk ? 'ok' : 'error',
        detail: supabaseOk ? `${holdingCount} rows` : 'Unreachable',
      },
      {
        label: 'Trades table',
        status: supabaseOk ? 'ok' : 'error',
        detail: supabaseOk ? `${tradeCountLocal} rows` : 'Unreachable',
      },
    ]);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    load();
    runHealthCheck();
  }, [unlocked]);

  async function handleResetAll() {
    setBusyResetAll(true);
    try { await adminResetAll(); await load(); }
    catch {}
    finally { setBusyResetAll(false); setConfirmResetAll(false); }
  }

  if (!unlocked) return <AdminLogin onUnlock={() => setUnlocked(true)} />;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px 16px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'rgba(22,82,240,0.12)', border: '1px solid rgba(22,82,240,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={18} style={{ color: 'var(--accent-blue)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Admin
          </h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            {players.length} players · {tradeCount} trades total
          </p>
        </div>
        <button
          onClick={load}
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, margin: '0 16px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border-default)', padding: 3 }}>
        {(['players', 'health'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'health') runHealthCheck(); }}
            style={{
              flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
              background: tab === t ? 'var(--bg-elevated)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            {t === 'health' ? '⚡ Health' : '👤 Players'}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <>
          {/* Nuclear reset */}
          <div style={{ margin: '0 16px 16px' }}>
            <button
              onClick={() => setConfirmResetAll(true)}
              disabled={busyResetAll}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', borderRadius: 12,
                background: 'rgba(246,70,93,0.06)', border: '1px solid rgba(246,70,93,0.2)',
                cursor: 'pointer', opacity: busyResetAll ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RotateCcw size={16} style={{ color: 'var(--color-down)' }} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-down)' }}>Reset All Standings</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    Clears all trades, holdings · restores $1,000 cash to everyone
                  </div>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-down)' }} />
            </button>
          </div>

          {/* Player list */}
          <div style={{ margin: '0 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>
              Players
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '0 14px' }}>
              {loading ? (
                [1,2,3].map(i => <div key={i} style={{ height: 52, background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 8 }} className="animate-pulse" />)
              ) : players.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>No players yet</div>
              ) : (
                players.map(p => (
                  <PlayerAdminRow key={p.id} player={p} holdings={holdings} onAction={load} />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'health' && (
        <div style={{ margin: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
              System Health
            </div>
            <button
              onClick={runHealthCheck}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              <Activity size={12} /> Run check
            </button>
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '0 14px' }}>
            {health.map(item => <HealthRow key={item.label} item={item} />)}
          </div>
        </div>
      )}

      {confirmResetAll && (
        <ConfirmDialog
          message="Reset ALL standings? Every player gets $1,000 cash back. All trades and holdings are wiped. This cannot be undone."
          onConfirm={handleResetAll}
          onCancel={() => setConfirmResetAll(false)}
          danger
        />
      )}
    </div>
  );
}
