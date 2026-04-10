import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import Search from './pages/Search'
import Leaderboard from './pages/Leaderboard'
import Portfolio from './pages/Portfolio'
import PlayerPortfolio from './pages/PlayerPortfolio'
import Admin from './pages/Admin'
import NewsPage from './pages/News'
import CongressPage from './pages/Congress'
import FundsPage from './pages/Funds'
import LoginModal from './components/auth/LoginModal'
import { useLeagueStore } from './store/leagueStore'
import { supabase, getPlayerByGoogleEmail } from './api/supabase'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY

export default function App() {
  const { setPlayer } = useLeagueStore()
  // null = loading, undefined = no session, Session = authenticated
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  // ── Handle Google OAuth redirect + session restore ──────────────────────
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setSession(null) // no auth configured → open access
      return
    }

    // Restore existing session on load
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession ?? null)
        if (newSession?.user?.email) {
          // Opportunistically match to league player — not required
          const found = await getPlayerByGoogleEmail(newSession.user.email)
          if (found) setPlayer(found)
        } else {
          setPlayer(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [setPlayer])

  // Still loading session
  if (session === undefined) return null

  // Not authenticated — show login wall
  if (!session && SUPABASE_CONFIGURED) {
    return <LoginModal />
  }

  return (
    <AppShell>
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
        <Route path="/congress" element={<CongressPage />} />
        <Route path="/funds" element={<FundsPage />} />
      </Routes>
    </AppShell>
  )
}
