import { Routes, Route } from 'react-router-dom'
import { useEffect, useState, Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import LoginModal from './components/auth/LoginModal'
import ErrorBoundary from './components/ui/ErrorBoundary'

const importStockDetail = () => import('./pages/StockDetail')
const importSearch = () => import('./pages/Search')
const importLeaderboard = () => import('./pages/Leaderboard')
const importPortfolio = () => import('./pages/Portfolio')
const importPlayerPortfolio = () => import('./pages/PlayerPortfolio')
const importAdmin = () => import('./pages/Admin')
const importNews = () => import('./pages/News')
const importNewsImpact = () => import('./pages/NewsImpact')
const importAgentAlerts = () => import('./pages/AgentAlerts')
const importRedditTrends = () => import('./pages/RedditTrends')
const importXTrends = () => import('./pages/XTrends')
const importInsiderActivity = () => import('./pages/InsiderActivity')
const importCongress = () => import('./pages/Congress')
const importFunds = () => import('./pages/Funds')

// Lazy-load heavy pages to reduce initial bundle size
const StockDetail         = lazyWithAutoReload(importStockDetail)
const Search              = lazyWithAutoReload(importSearch)
const Leaderboard         = lazyWithAutoReload(importLeaderboard)
const Portfolio           = lazyWithAutoReload(importPortfolio)
const PlayerPortfolio     = lazyWithAutoReload(importPlayerPortfolio)
const Admin               = lazyWithAutoReload(importAdmin)
const NewsPage            = lazyWithAutoReload(importNews)
const NewsImpactPage      = lazyWithAutoReload(importNewsImpact)
const AgentAlertsPage     = lazyWithAutoReload(importAgentAlerts)
const RedditTrendsPage    = lazyWithAutoReload(importRedditTrends)
const XTrendsPage         = lazyWithAutoReload(importXTrends)
const InsiderActivityPage = lazyWithAutoReload(importInsiderActivity)
const CongressPage        = lazyWithAutoReload(importCongress)
const FundsPage           = lazyWithAutoReload(importFunds)
import { useLeagueStore } from './store/leagueStore'
import { useWatchlistStore } from './store/watchlistStore'
import { syncPendingTradesForPlayer } from './store/pendingTradeStore'
import { supabase, ensurePlayerForSession, touchPlayerActivity } from './api/supabase'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY

const LAZY_RELOAD_KEY = 'tars:lazy-reload'
const BOOTSTRAP_RETRY_DELAY_MS = 1200
const IDLE_LOGOUT_MS = 30 * 60 * 1000
const ACTIVITY_HEARTBEAT_MS = 60 * 1000
const PENDING_TRADE_SYNC_MS = 15 * 1000

function lazyWithAutoReload<T extends { default: ComponentType<any> }>(
  importer: () => Promise<T>
) {
  return lazy(async () => {
    try {
      const mod = await importer()
      sessionStorage.removeItem(LAZY_RELOAD_KEY)
      return mod
    } catch (err) {
      const message = String((err as Error)?.message || err)
      const isChunkLoadError =
        /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message)

      if (isChunkLoadError && sessionStorage.getItem(LAZY_RELOAD_KEY) !== '1') {
        sessionStorage.setItem(LAZY_RELOAD_KEY, '1')
        window.location.reload()
        return new Promise<T>(() => {})
      }

      throw err
    }
  })
}

export default function App() {
  const { player, setPlayer, setPlayerStatus, logout } = useLeagueStore()
  const initializeWatchlist = useWatchlistStore((state) => state.initialize)
  // null = loading, undefined = no session, Session = authenticated
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  // ── Handle Google OAuth redirect + session restore ──────────────────────
  useEffect(() => {
    let isActive = true
    let sessionRunId = 0

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const resolvePlayerWithRetry = async (nextSession: Session) => {
      try {
        return await ensurePlayerForSession(nextSession)
      } catch (err) {
        console.warn('[App] first player bootstrap attempt failed, retrying once:', err)
        await sleep(BOOTSTRAP_RETRY_DELAY_MS)
        return ensurePlayerForSession(nextSession)
      }
    }

    const applySession = async (nextSession: Session | null) => {
      const runId = ++sessionRunId
      setSession(nextSession)

      if (!nextSession?.user?.email) {
        setPlayerStatus('idle')
        setPlayer(null)
        void initializeWatchlist(null)
        return
      }

      const nextEmail = nextSession.user.email.toLowerCase()
      const currentEmail = player?.google_email?.toLowerCase()
      if (currentEmail && currentEmail !== nextEmail) {
        setPlayer(null)
        void initializeWatchlist(null)
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
        const player = await resolvePlayerWithRetry(nextSession)
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
  }, [initializeWatchlist, player?.google_email, setPlayer, setPlayerStatus])

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !session) return

    let timeoutId: number | null = null
    let lastHeartbeatAt = 0

    const sendHeartbeat = () => {
      if (!player?.id) return
      const now = Date.now()
      if (now - lastHeartbeatAt < ACTIVITY_HEARTBEAT_MS) return
      lastHeartbeatAt = now
      void touchPlayerActivity(player.id).catch((error) => {
        console.warn('[App] failed to update activity heartbeat:', error)
      })
    }

    const resetIdleTimer = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        console.warn('[App] signing out idle session after inactivity timeout')
        void logout()
      }, IDLE_LOGOUT_MS)
      sendHeartbeat()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resetIdleTimer()
      }
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'scroll',
      'focus',
    ]

    resetIdleTimer()
    sendHeartbeat()
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetIdleTimer, { passive: true })
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetIdleTimer)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [logout, player?.id, session])

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !session || !player?.id) return

    let intervalId: number | null = null

    const runSync = () => {
      void syncPendingTradesForPlayer(player).catch((error) => {
        console.warn('[App] pending trade sync failed:', error)
      })
    }

    const handleOnline = () => runSync()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') runSync()
    }

    runSync()
    intervalId = window.setInterval(runSync, PENDING_TRADE_SYNC_MS)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [player, session])

  useEffect(() => {
    if (!session) return

    void importPortfolio()
    void importPlayerPortfolio()
  }, [session])

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
            <Route path="/" element={<Dashboard />} />
            <Route path="/stock/:symbol" element={<StockDetail />} />
            <Route path="/search" element={<Search />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/players" element={<Leaderboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/portfolio/:playerId" element={<PlayerPortfolio />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/news-impact" element={<NewsImpactPage />} />
            <Route path="/alerts" element={<AgentAlertsPage />} />
            <Route path="/reddit-trends" element={<RedditTrendsPage />} />
            <Route path="/x-trends" element={<XTrendsPage />} />
            <Route path="/insiders" element={<InsiderActivityPage />} />
            <Route path="/congress" element={<CongressPage />} />
            <Route path="/funds" element={<FundsPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  )
}
