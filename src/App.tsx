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
import { supabase, getPlayerByGoogleEmail } from './api/supabase'

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

      const found = await getPlayerByGoogleEmail(nextSession.user.email)
      setPlayer(found ?? null)
      await initializeWatchlist(found?.id ?? null)
    }

    if (!SUPABASE_CONFIGURED) {
      setSession(null) // no auth configured → open access
      void initializeWatchlist(null)
      return
    }

    // Restore existing session on load
    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        await applySession(newSession ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [initializeWatchlist, setPlayer])

  // Still loading session
  if (session === undefined) return null

  // Not authenticated — show login wall
  if (!session && SUPABASE_CONFIGURED) {
    return <LoginModal />
  }

  return (
    <AppShell>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
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
