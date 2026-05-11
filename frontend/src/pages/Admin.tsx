import { useState, useRef } from 'react'
import { api } from '../api'
import './pages.css'

export default function Admin() {
  const [raceName, setRaceName] = useState('')
  const [raceDate, setRaceDate] = useState('')
  const [points, setPoints] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ race_id: number; added_results: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = raceName.trim() && raceDate && points !== '' && file && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await api.uploadRaceResult({
        file: file!,
        race_name: raceName.trim(),
        race_date: raceDate,
        points: Number(points),
        note: note.trim(),
      })
      setResult({ race_id: res.race_id, added_results: res.added_results })
      setRaceName('')
      setRaceDate('')
      setPoints('')
      setNote('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>レース結果アップロード</h2>
      </div>
      <p className="desc">Excelファイルと大会情報を入力してアップロードしてください。</p>

      <form className="upload-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">
            大会名 <span className="required">*</span>
          </label>
          <input
            className="form-input"
            type="text"
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            placeholder="例: 2025 World Triathlon Para Championships"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            開催日 <span className="required">*</span>
          </label>
          <input
            className="form-input"
            type="date"
            value={raceDate}
            onChange={(e) => setRaceDate(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            優勝ポイント（150〜750） <span className="required">*</span>
          </label>
          <input
            className="form-input"
            type="number"
            value={points}
            onChange={(e) => setPoints(e.target.value === '' ? '' : Number(e.target.value))}
            min={150}
            max={750}
            step={1}
            placeholder="例: 750"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">補足</label>
          <textarea
            className="form-input form-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="任意のメモ（開催場所、特記事項など）"
            rows={3}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Excelファイル（.xlsx） <span className="required">*</span>
          </label>
          <input
            ref={fileRef}
            className="form-input"
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>

        <button className="submit-btn" type="submit" disabled={!canSubmit}>
          {loading ? 'アップロード中...' : 'アップロード'}
        </button>
      </form>

      {result && (
        <div className="upload-success">
          インポート完了 — {result.added_results}件の結果を登録しました（race_id: {result.race_id}）
        </div>
      )}
      {error && (
        <div className="upload-error">{error}</div>
      )}
    </div>
  )
}
