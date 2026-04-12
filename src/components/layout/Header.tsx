import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, Search, X, Trophy, User } from 'lucide-react';

// TARS logo — a 4-pointed star ✦ because TARS is an anagram of STAR
function TarsIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1C8 1 8.8 5.2 11.2 6.8C13.6 8.4 15 8 15 8C15 8 13.6 7.6 11.2 9.2C8.8 10.8 8 15 8 15C8 15 7.2 10.8 4.8 9.2C2.4 7.6 1 8 1 8C1 8 2.4 8.4 4.8 6.8C7.2 5.2 8 1 8 1Z"
        fill="white"
      />
    </svg>
  );
}
import { SearchBar } from '../ui/SearchBar';
import { useLeagueStore } from '../../store/leagueStore';
import LoginModal from '../auth/LoginModal';

interface HeaderProps {
  onMenuClick?: () => void;
}

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export function Header({ onMenuClick }: HeaderProps) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const { player } = useLeagueStore();
  const navigate = useNavigate();

  return (
    <>
      <header
        className="flex items-center flex-shrink-0"
        style={{
          height: 56,
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-subtle)',
          zIndex: 100,
          position: 'relative',
        }}
      >
        {/* ── Mobile layout ── */}
        <div className="flex lg:hidden items-center w-full px-4 gap-3">
          {/* Hamburger */}
          <button
            onClick={onMenuClick}
            aria-label="Open watchlist"
            className="flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ width: 44, height: 44, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            <Menu size={20} />
          </button>

          {/* Logo — centered */}
          <Link to="/" className="flex items-center gap-2 no-underline flex-1 justify-center" title="TARS">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-blue)' }}>
              <TarsIcon size={15} />
            </div>
            <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              TARS
            </span>
          </Link>

          {/* Right: search + player */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Search stocks"
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ width: 44, height: 44, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <Search size={20} />
            </button>

            {SUPABASE_CONFIGURED && (
              player ? (
                <button
                  onClick={() => navigate('/portfolio')}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: player.avatar_color, color: '#fff', border: 'none', cursor: 'pointer' }}
                  title={player.name}
                >
                  {player.name[0].toUpperCase()}
                </button>
              ) : (
                <button
                  onClick={() => setShowLogin(true)}
                  className="flex items-center justify-center rounded-xl flex-shrink-0"
                  style={{ width: 44, height: 44, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                  title="Join the league"
                >
                  <User size={19} />
                </button>
              )
            )}
          </div>
        </div>

        {/* ── Desktop layout ── */}
        <div className="hidden lg:flex items-center gap-6 px-6 w-full">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 no-underline flex-shrink-0" title="TARS">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-blue)' }}>
              <TarsIcon size={17} />
            </div>
            <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              TARS
            </span>
          </Link>

          <div style={{ width: 1, height: 20, background: 'var(--border-default)', flexShrink: 0 }} />

          {/* Search */}
          <div className="flex-1 flex justify-center">
            <SearchBar />
          </div>

          {/* Right nav */}
          {SUPABASE_CONFIGURED && (
            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                to="/leaderboard"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium no-underline"
                style={{ color: 'var(--text-secondary)', background: 'transparent', transition: 'color 150ms' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                <Trophy size={15} />
                League
              </Link>

              {player ? (
                <button
                  onClick={() => navigate('/portfolio')}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: player.avatar_color, color: '#fff' }}
                  >
                    {player.name[0].toUpperCase()}
                  </div>
                  {player.name.split(' ')[0]}
                </button>
              ) : (
                <button
                  onClick={() => setShowLogin(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Join League
                </button>
              )}
            </div>
          )}

          {/* Spacer when no league nav */}
          {!SUPABASE_CONFIGURED && <div style={{ width: 140, flexShrink: 0 }} />}
        </div>

        {/* Mobile full-screen search overlay */}
        {mobileSearchOpen && (
          <div className="fixed inset-0 lg:hidden flex flex-col" style={{ zIndex: 200, background: 'var(--bg-primary)' }}>
            <div
              className="flex items-center gap-3 px-4"
              style={{ height: 56, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
            >
              <div className="flex-1">
                <SearchBar autoFocus onClose={() => setMobileSearchOpen(false)} />
              </div>
              <button
                onClick={() => setMobileSearchOpen(false)}
                aria-label="Close search"
                className="flex items-center justify-center rounded-xl flex-shrink-0"
                style={{ width: 44, height: 44, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}
      </header>

      {showLogin && <LoginModal />}
    </>
  );
}
