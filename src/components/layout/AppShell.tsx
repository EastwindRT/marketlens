import { ReactNode, useState, useEffect } from 'react';
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

        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
