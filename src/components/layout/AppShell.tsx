import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Newspaper, Building2, Menu, BarChart2 } from 'lucide-react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change (escape key)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      <Header onMenuClick={() => setDrawerOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* Mobile drawer overlay */}
        {drawerOpen && (
          <div
            className="fixed inset-0 lg:hidden"
            style={{ zIndex: 40, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile slide-in drawer */}
        <div
          className="fixed top-0 left-0 h-full lg:hidden"
          style={{
            zIndex: 50,
            width: 280,
            transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 200ms ease-out',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
          }}
          aria-label="Watchlist drawer"
        >
          <Sidebar onClose={() => setDrawerOpen(false)} />
        </div>

        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-primary)', paddingBottom: 60 }}>
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <MobileBottomNav onMenuClick={() => setDrawerOpen(true)} />
    </div>
  );
}

function MobileBottomNav({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();

  const navItems = [
    { to: '/news',        icon: <Newspaper size={20} />, label: 'Signals'  },
    { to: '/congress',    icon: <Building2 size={20} />, label: 'Congress' },
    { to: '/dashboard',   icon: <BarChart2 size={20} />, label: 'Watchlist' },
  ];

  return (
    <div
      className="flex lg:hidden"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 60, zIndex: 30,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'stretch',
      }}
    >
      {navItems.map(item => {
        const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
        return (
          <Link
            key={item.to}
            to={item.to}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 3,
              textDecoration: 'none',
              color: isActive ? 'var(--accent-blue-light)' : 'var(--text-tertiary)',
              transition: 'color 150ms',
            }}
          >
            <span style={{ opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: "'Inter', sans-serif" }}>
              {item.label}
            </span>
            {isActive && (
              <div style={{ position: 'absolute', bottom: 0, width: 24, height: 2, borderRadius: 1, background: 'var(--accent-blue-light)' }} />
            )}
          </Link>
        );
      })}

      {/* Menu / watchlist button */}
      <button
        onClick={onMenuClick}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 3,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-tertiary)',
        }}
      >
        <Menu size={20} style={{ opacity: 0.7 }} />
        <span style={{ fontSize: 10, fontWeight: 500, fontFamily: "'Inter', sans-serif" }}>Watchlist</span>
      </button>
    </div>
  );
}
