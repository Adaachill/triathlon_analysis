import { Routes, Route, NavLink } from 'react-router-dom'
import './App.css'
import Rankings from './pages/Rankings'
import Races from './pages/Races'
import RaceDetail from './pages/RaceDetail'
import AthleteDetail from './pages/AthleteDetail'

function App() {
  return (
    <div className="app">
      <header className="header">
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            ランキング
          </NavLink>
          <NavLink to="/races" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            レース一覧
          </NavLink>
        </nav>
        <h1 className="logo">Triathlon Analysis</h1>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Rankings />} />
          <Route path="/races" element={<Races />} />
          <Route path="/races/:raceId" element={<RaceDetail />} />
          <Route path="/athletes/:athleteId" element={<AthleteDetail />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
