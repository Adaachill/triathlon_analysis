import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { LoadingState, TableSkeleton } from '../components/Loading'
import './pages.css'

export default function Races() {
  const [races, setRaces] = useState<Awaited<ReturnType<typeof api.getRaces>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getRaces()
      .then((r) => {
        const sorted = [...r].sort((a, b) => {
          if (!a.date && !b.date) return 0
          if (!a.date) return 1
          if (!b.date) return -1
          return b.date.localeCompare(a.date)
        })
        setRaces(sorted)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (loading) {
    return (
      <div className="races-page">
        <div className="card">
          <LoadingState variant="card" />
          <TableSkeleton rows={8} cols={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="races-page">
      <div className="card">
        <div className="page-header">
          <h2>レース一覧</h2>
        </div>

        <div className="table-wrap">
          <table className="data-table races-table">
            <thead>
              <tr>
                <th>大会名</th>
                <th>日付</th>
                <th>大会ID</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {races.map((race) => (
                <tr key={race.id}>
                  <td>
                    <Link to={`/races/${race.id}`} className="race-table-link">
                      <span className="race-table-name">
                        {race.name || `Race ${race.event_id}`}
                      </span>
                      {race.is_reference && <span className="badge" style={{ marginLeft: '0.5rem' }}>基準</span>}
                    </Link>
                  </td>
                  <td className="race-table-date">{race.date ?? '--'}</td>
                  <td className="race-table-id">{race.event_id}</td>
                  <td className="race-table-id">{race.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
