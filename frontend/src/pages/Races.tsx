import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import './pages.css'

export default function Races() {
  const [races, setRaces] = useState<Awaited<ReturnType<typeof api.getRaces>>>([])
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getRaces(), api.getPrograms()])
      .then(([r, p]) => {
        setRaces(r)
        setPrograms(p.programs)
        setProgram(p.programs.includes('PTS4 Men') ? 'PTS4 Men' : (p.programs[0] ?? ''))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (loading) return <div className="loading">読み込み中...</div>

  return (
    <div className="races-page">
      <div className="card">
        <div className="page-header">
          <h2>レース一覧</h2>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <p className="desc">
          レースをクリックすると、該当カテゴリの結果と標準化タイムを表示します。
        </p>

        <div className="race-grid">
          {races.map((race) => (
            <Link
              key={race.id}
              to={`/races/${race.id}${program ? `?program=${encodeURIComponent(program)}` : ''}`}
              className="race-card"
            >
              <span className="race-id">ID: {race.id}</span>
              <span className="race-event">{race.event_id}</span>
              {race.name && <span className="race-name">{race.name}</span>}
              {race.date && <span className="race-date">{race.date}</span>}
              {race.is_reference && <span className="badge">基準</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
