import { useState, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import './App.css'
import Rankings from './pages/Rankings'
import Races from './pages/Races'
import RaceDetail from './pages/RaceDetail'
import AthleteDetail from './pages/AthleteDetail'
import Predict from './pages/Predict'
import Admin from './pages/Admin'
import Guide from './pages/Guide'
import WorldRanking from './pages/WorldRanking'
import WtImport from './pages/WtImport'
import { warmupBackend } from './warmup'

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  // 起動直後にバックエンドを温める（Render スリープ復帰の30〜60秒を裏で消化）
  useEffect(() => { warmupBackend() }, [])

  // Close drawer on navigation
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  // Close drawer on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const navLinks = (
    <>
      <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        📖 使い方
      </NavLink>
      <NavLink to="/rankings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        🏆 ランキング
      </NavLink>
      <NavLink to="/races" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        🏁 レース一覧
      </NavLink>
      <NavLink to="/predict" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        🔮 予想リザルト
      </NavLink>
      <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        📤 レース結果アップロード
      </NavLink>
      <NavLink to="/admin/wt-import" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
        WT大会インポート
      </NavLink>
      <NavLink to="/world-ranking" className={({ isActive }) => isActive ? 'nav-link nav-link-dev active' : 'nav-link nav-link-dev'}>
        🌍 世界ランク試算
      </NavLink>
    </>
  )

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">🏅 Triathlon Analysis</h1>

        {/* Desktop nav */}
        <nav className="nav nav-desktop">
          {navLinks}
        </nav>

        {/* Mobile hamburger */}
        <button
          className={`hamburger${menuOpen ? ' hamburger-open' : ''}`}
          aria-label="メニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}
      <div ref={navRef} className={`nav-drawer${menuOpen ? ' nav-drawer-open' : ''}`}>
        <nav className="nav-drawer-links">
          {navLinks}
        </nav>
      </div>

      <main className="main">
        <Routes>
          <Route path="/" element={<Guide />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/races" element={<Races />} />
          <Route path="/races/:raceId" element={<RaceDetail />} />
          <Route path="/athletes/:athleteId" element={<AthleteDetail />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/wt-import" element={<WtImport />} />
          <Route path="/world-ranking" element={<WorldRanking />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
