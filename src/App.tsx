import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import Search from './pages/Search'
import Leaderboard from './pages/Leaderboard'
import Portfolio from './pages/Portfolio'
import LoginModal from './components/auth/LoginModal'
import { useLeagueStore } from './store/leagueStore'

// Check if Supabase is configured
const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY

export default function App() {
  const { player } = useLeagueStore()
  const [showLogin, setShowLogin] = useState(false)

  // Show login prompt once on first visit if Supabase is set up and no session
  useEffect(() => {
    if (SUPABASE_CONFIGURED && !player) {
      const timer = setTimeout(() => setShowLogin(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/stock/AAPL" replace />} />
          <Route path="/stock/:symbol" element={<StockDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
        </Routes>
      </AppShell>

      {/* Login modal — shown on first visit or when triggered from header */}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
