import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, Suspense, lazy } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import LoginModal from './components/auth/LoginModal'

// Lazy-load heavy pages to reduce initial bundle size
const StockDetail       = lazy(() => import('./pages/StockDetail'))
const Search            = lazy(() => import('./pages/Search'))
const Leaderboard       = lazy(() => import('./pages/Leaderboard'))
const Portfolio         = lazy(() => import('./pages/Portfolio'))
const PlayerPortfolio   = lazy(() => import('./pages/PlayerPortfolio'))
const Admin             = lazy(() => import('./pages/Admin'))
const NewsPage          = lazy(() => import('./pages/News'))
const InsiderActivityPage = lazy(() => import('./pages/InsiderActivity'))
const CongressPage      = lazy(() => import('./pages/Congress'))
const FundsPage         = lazy(() => import('./pages/Funds'))
import { useLeagueStore } from './store/leagueStore'
import { useWatchlistStore } from './store/watchlistStore'
import { supabase, ensurePlayerForSession } from './api/supabase'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY

export default function App() {
  const { setPlayer } = useLeagueStore()
  const initializeWatchlist = useWatchlistStore((state) => state.initialize)
  // null = loading, undefined = no session, Session = authenticated
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  // ── Handle Google OAuth redirect + session restore ──────────────────────
  useEffect(() => {
    const applySession = async (nextSession: Session | null) => {
      setSession(nextSession)

      if (!nextSession?.user?.email) {
        setPlayer(null)
        await initializeWatchlist(null)
        return
      }

      // Create the player row on first login, return it on subsequent logins.
      const player = await ensurePlayerForSession(nextSession)
      setPlayer(player ?? null)
      await initializeWatchlist(player?.id ?? null)
    }

    if (!SUPABASE_CONFIGURED) {
      setSession(null) // no auth configured → open access
      void initializeWatchlist(null)
      return
    }

    // Restore existing session on load — with a 10-second timeout so a
    // hung network request on mobile never leaves the app on a blank screen.
    const sessionTimeout = setTimeout(() => {
      setSession((prev) => (prev === undefined ? null : prev))
    }, 10_000)

    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(sessionTimeout)
      void applySession(data.session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        await applySession(newSession ?? null)
      }
    )

    return () => { subscription.unsubscribe(); clearTimeout(sessionTimeout) }
  }, [initializeWatchlist, setPlayer])

  // Still loading session — show spinner instead of blank screen
  if (session === undefined) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', background: 'var(--bg-primary)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '3px solid var(--border-default)',
          borderTopColor: 'var(--accent-blue)',
          animation: 'spin 0.75s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Not authenticated — show login wall
  if (!session && SUPABASE_CONFIGURED) {
    return <LoginModal />
  }

  return (
    <AppShell>
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--border-default)', borderTopColor: 'var(--accent-blue)', animation: 'spin 0.75s linear infinite' }} />
        </div>
      }>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/players" element={<Leaderboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/portfolio/:playerId" element={<PlayerPortfolio />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/insiders" element={<InsiderActivityPage />} />
          <Route path="/congress" element={<CongressPage />} />
          <Route path="/funds" element={<FundsPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
