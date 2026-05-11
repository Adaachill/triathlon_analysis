import { Routes, Route, NavLink } from 'react-router-dom'
import './App.css'
import Rankings from './pages/Rankings'
import Races from './pages/Races'
import RaceDetail from './pages/RaceDetail'
import AthleteDetail from './pages/AthleteDetail'
import Predict from './pages/Predict'
import Admin from './pages/Admin'
import Guide from './pages/Guide'
import WorldRanking from './pages/WorldRanking'

function App() {
  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">Triathlon Analysis</h1>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            使い方
          </NavLink>
          <NavLink to="/rankings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            ランキング
          </NavLink>
          <NavLink to="/races" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            レース一覧
          </NavLink>
          <NavLink to="/predict" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            予想リザルト
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            レース結果アップロード
          </NavLink>
          <NavLink to="/world-ranking" className={({ isActive }) => isActive ? 'nav-link nav-link-dev active' : 'nav-link nav-link-dev'}>
            世界ランク試算
          </NavLink>
        </nav>
      </header>

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
          <Route path="/world-ranking" element={<WorldRanking />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
