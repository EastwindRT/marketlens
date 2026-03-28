import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Menu, Search, X } from 'lucide-react';
import { SearchBar } from '../ui/SearchBar';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
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
          style={{
            width: 44,
            height: 44,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <Menu size={20} />
        </button>

        {/* Logo — centered */}
        <Link to="/" className="flex items-center gap-2 no-underline flex-1 justify-center">
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-blue)' }}
          >
            <TrendingUp size={14} color="white" strokeWidth={2.5} />
          </div>
          <span
            className="font-bold text-sm tracking-tight"
            style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
          >
            MarketLens
          </span>
        </Link>

        {/* Search icon button */}
        <button
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Search stocks"
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 44,
            height: 44,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <Search size={20} />
        </button>
      </div>

      {/* ── Desktop layout ── */}
      <div className="hidden lg:flex items-center gap-6 px-6 w-full">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 no-underline flex-shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-blue)' }}
          >
            <TrendingUp size={16} color="white" strokeWidth={2.5} />
          </div>
          <span
            className="font-bold text-sm tracking-tight"
            style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
          >
            MarketLens
          </span>
        </Link>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: 'var(--border-default)', flexShrink: 0 }} />

        {/* Search — centered */}
        <div className="flex-1 flex justify-center">
          <SearchBar />
        </div>

        {/* Right spacer to balance logo */}
        <div style={{ width: 140, flexShrink: 0 }} />
      </div>

      {/* ── Mobile full-screen search overlay ── */}
      {mobileSearchOpen && (
        <div
          className="fixed inset-0 lg:hidden flex flex-col"
          style={{
            zIndex: 200,
            background: 'var(--bg-primary)',
          }}
        >
          {/* Overlay header */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              height: 56,
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            <div className="flex-1">
              <SearchBar
                autoFocus
                onClose={() => setMobileSearchOpen(false)}
              />
            </div>
            <button
              onClick={() => setMobileSearchOpen(false)}
              aria-label="Close search"
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                width: 44,
                height: 44,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
