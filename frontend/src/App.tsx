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

type Theme = 'light' | 'dark' | 'system'

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem('theme') as Theme | null
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

const BOTTOM_TABS = [
  { to: '/',          label: 'ホーム',     icon: '📖', end: true  },
  { to: '/rankings',  label: 'ランキング', icon: '🏆', end: false },
  { to: '/races',     label: 'レース',     icon: '🏁', end: false },
  { to: '/predict',   label: '予想',       icon: '🔮', end: false },
] as const

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  // Apply theme on mount and change
  useEffect(() => {
    applyTheme(theme)
    if (theme === 'system') window.localStorage.removeItem('theme')
    else window.localStorage.setItem('theme', theme)
  }, [theme])

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

  const cycleTheme = () => {
    setTheme((cur) => cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light')
  }

  const themeIcon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🌓'
  const themeTitle = theme === 'light' ? 'ライトモード' : theme === 'dark' ? 'ダークモード' : 'システム設定に従う'

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

        {/* Theme toggle */}
        <button
          className="theme-toggle"
          onClick={cycleTheme}
          title={`テーマ: ${themeTitle}（クリックで切替）`}
          aria-label="テーマを切り替え"
        >
          <span aria-hidden>{themeIcon}</span>
        </button>

        {/* Mobile overflow menu (drawer trigger) */}
        <button
          className={`hamburger${menuOpen ? ' hamburger-open' : ''}`}
          aria-label="その他メニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </header>

      {/* Mobile drawer (overflow links: その他項目) */}
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

      {/* モバイル下部ボトムタブバー */}
      <nav className="bottom-tabs" aria-label="メイン">
        <div className="bottom-tabs-inner">
          {BOTTOM_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}
            >
              <span className="bottom-tab-icon" aria-hidden>{t.icon}</span>
              <span className="bottom-tab-label">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

export default App
