import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
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
import LoginModal from './components/auth/LoginModal'
import { useLeagueStore } from './store/leagueStore'
import { supabase, getPlayerByGoogleEmail, signOutGoogle } from './api/supabase'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY

export default function App() {
  const { player, setPlayer } = useLeagueStore()
  const [showLogin, setShowLogin] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // ── Handle Google OAuth redirect + session restore ──────────────────────
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user?.email) {
          const email = session.user.email
          const found = await getPlayerByGoogleEmail(email)
          if (found) {
            setPlayer(found)
            setShowLogin(false)
            setAuthError(null)
          } else {
            // Authenticated with Google but email not linked to any player
            await signOutGoogle()
            setAuthError(
              `${email} is not linked to a league player. Ask your admin to add your Google email in Supabase.`
            )
            setShowLogin(true)
          }
        }
        if (event === 'SIGNED_OUT') {
          setPlayer(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [setPlayer])

  // ── Show login prompt on first visit if not signed in ───────────────────
  useEffect(() => {
    if (SUPABASE_CONFIGURED && !player) {
      const timer = setTimeout(() => setShowLogin(true), 800)
      return () => clearTimeout(timer)
    }
  }, [player])

  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/leaderboard" replace />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/portfolio/:playerId" element={<PlayerPortfolio />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/congress" element={<CongressPage />} />
        </Routes>
      </AppShell>

      {showLogin && (
        <LoginModal
          onClose={() => { setShowLogin(false); setAuthError(null) }}
          authError={authError}
        />
      )}
    </>
  )
}
