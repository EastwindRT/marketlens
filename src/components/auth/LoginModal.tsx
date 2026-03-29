import React, { useState, useEffect } from 'react';
import { TrendingUp, Lock } from 'lucide-react';
import { getAllPlayers, loginPlayer } from '../../api/supabase';
import { useLeagueStore } from '../../store/leagueStore';
import type { Player } from '../../api/supabase';

interface LoginModalProps {
  onClose?: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const setPlayer = useLeagueStore((s) => s.setPlayer);

  useEffect(() => {
    getAllPlayers()
      .then(setPlayers)
      .catch(() => setError('Could not connect to database. Check your Supabase keys.'))
      .finally(() => setFetching(false));
  }, []);

  async function handleLogin() {
    if (!selected) { setError('Pick your name'); return; }
    if (!pin) { setError('Enter your PIN'); return; }
    setLoading(true);
    setError('');
    const player = await loginPlayer(selected, pin);
    setLoading(false);
    if (!player) {
      setError('Wrong PIN. Try again.');
      setPin('');
      return;
    }
    setPlayer(player);
    onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 pt-2">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--accent-blue)' }}
          >
            <TrendingUp size={24} color="white" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            MoneyTalks
          </h1>
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Pick your name and enter your PIN to join the league
          </p>
        </div>

        {/* Name picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            WHO ARE YOU?
          </label>
          {fetching ? (
            <div className="h-11 rounded-xl animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p.name); setError(''); }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: selected === p.name ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                    color: selected === p.name ? '#fff' : 'var(--text-primary)',
                    border: selected === p.name ? '1px solid var(--accent-blue)' : '1px solid var(--border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ background: p.avatar_color }}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* PIN */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            PIN
          </label>
          <div
            className="flex items-center gap-3 px-4 rounded-xl"
            style={{
              background: 'var(--bg-elevated)',
              border: `1px solid ${error ? 'var(--color-down)' : 'var(--border-default)'}`,
              height: 48,
            }}
          >
            <Lock size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="4-digit PIN"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-center" style={{ color: 'var(--color-down)' }}>{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-opacity"
          style={{
            background: 'var(--accent-blue)',
            color: '#fff',
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            border: 'none',
          }}
        >
          {loading ? 'Signing in…' : 'Enter League'}
        </button>
      </div>
    </div>
  );
}
