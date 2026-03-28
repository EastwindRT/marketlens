import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import Search from './pages/Search'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/stock/AAPL" replace />} />
        <Route path="/stock/:symbol" element={<StockDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </AppShell>
  )
}
