import React, { useState } from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { signInWithGoogle } from '../../api/supabase';

interface LoginModalProps {
  onClose?: () => void;
  authError?: string | null;
}

export default function LoginModal({ onClose, authError }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleGoogleSignIn() {
    setLoading(true);
    setLocalError('');
    try {
      await signInWithGoogle();
      // Page will redirect to Google — no return from here
    } catch {
      setLocalError('Could not start Google sign-in. Check your connection.');
      setLoading(false);
    }
  }

  const displayError = authError || localError;

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
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
          >
            MoneyTalks
          </h1>
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Sign in with your Google account to join the league
          </p>
        </div>

        {/* Error card */}
        {displayError && (
          <div
            className="flex items-start gap-3 p-3 rounded-xl"
            style={{
              background: 'rgba(246,70,93,0.1)',
              border: '1px solid rgba(246,70,93,0.3)',
            }}
          >
            <AlertCircle size={15} color="#F6465D" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 13, color: '#F6465D', lineHeight: 1.45 }}>
              {displayError}
            </p>
          </div>
        )}

        {/* Google Sign In button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-3 transition-opacity"
          style={{
            background: '#fff',
            color: '#1f1f1f',
            border: '1px solid #dadce0',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {/* Google 'G' logo */}
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path
              fill="#4285F4"
              d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.17z"
            />
            <path
              fill="#34A853"
              d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"
            />
            <path
              fill="#FBBC05"
              d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18z"
            />
            <path
              fill="#EA4335"
              d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"
            />
          </svg>
          {loading ? 'Redirecting to Google…' : 'Sign in with Google'}
        </button>

        <p className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Your Google account must be linked to a player by an admin
        </p>
      </div>
    </div>
  );
}
