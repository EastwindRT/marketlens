import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, Suspense, lazy } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import LoginModal from './components/auth/LoginModal'
import ErrorBoundary from './components/ui/ErrorBoundary'

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
  const { setPlayer, setPlayerStatus } = useLeagueStore()
  const initializeWatchlist = useWatchlistStore((state) => state.initialize)
  // null = loading, undefined = no session, Session = authenticated
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  // ── Handle Google OAuth redirect + session restore ──────────────────────
  useEffect(() => {
    let isActive = true
    let sessionRunId = 0

    const applySession = async (nextSession: Session | null) => {
      const runId = ++sessionRunId
      setSession(nextSession)

      if (!nextSession?.user?.email) {
        setPlayerStatus('idle')
        setPlayer(null)
        void initializeWatchlist(null)
        return
      }

      setPlayerStatus('loading')
      let didTimeout = false
      const playerTimeout = setTimeout(() => {
        didTimeout = true
        if (isActive && sessionRunId === runId) {
          setPlayerStatus('timed_out')
        }
      }, 8_000)

      // Create the player row on first login, return it on subsequent logins.
      // Don't let a failed lookup crash the whole app — log it loudly and
      // continue with player=null so the session is still usable and the user
      // sees routes (even if portfolio shows a skeleton) instead of a blank screen.
      try {
        const player = await ensurePlayerForSession(nextSession)
        if (!isActive || sessionRunId !== runId) return
        setPlayer(player ?? null)
        setPlayerStatus('ready')
        void initializeWatchlist(player?.id ?? null)
      } catch (err) {
        console.error('[App] ensurePlayerForSession failed:', err)
        if (!isActive || sessionRunId !== runId) return
        setPlayer(null)
        void initializeWatchlist(null)
        setPlayerStatus(didTimeout ? 'timed_out' : 'error')
      } finally {
        clearTimeout(playerTimeout)
      }
    }

    if (!SUPABASE_CONFIGURED) {
      setPlayerStatus('ready')
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

    return () => {
      isActive = false
      subscription.unsubscribe()
      clearTimeout(sessionTimeout)
    }
  }, [initializeWatchlist, setPlayer, setPlayerStatus])

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
      <ErrorBoundary label="route">
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
      </ErrorBoundary>
    </AppShell>
  )
}
