import { useMemo, useState } from 'react'
import { formatTime, type RankingEntry, type AthleteDetail } from '../api'
import './WhatIfSimulator.css'

type SegKey = 'strength_swim' | 'strength_t1' | 'strength_bike' | 'strength_t2' | 'strength_run'

const SEGS: { key: SegKey; label: string; icon: string; color: string; min: number; max: number }[] = [
  { key: 'strength_swim', label: 'Swim', icon: '🏊', color: '#38bdf8', min: -120, max: 60 },
  { key: 'strength_t1',   label: 'T1',   icon: '⚡', color: '#c4b5fd', min: -15,  max: 15 },
  { key: 'strength_bike', label: 'Bike', icon: '🚴', color: '#fb923c', min: -180, max: 90 },
  { key: 'strength_t2',   label: 'T2',   icon: '🔄', color: '#f9a8d4', min: -15,  max: 15 },
  { key: 'strength_run',  label: 'Run',  icon: '🏃', color: '#4ade80', min: -120, max: 60 },
]

function fmtDelta(s: number): string {
  if (s === 0) return '±0秒'
  const sign = s > 0 ? '+' : '-'
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const ss = Math.round(abs % 60)
  if (m === 0) return `${sign}${ss}秒`
  return `${sign}${m}分${String(ss).padStart(2, '0')}秒`
}

interface Props {
  athlete: AthleteDetail
  rankings: RankingEntry[] | null
}

export default function WhatIfSimulator({ athlete, rankings }: Props) {
  const [deltas, setDeltas] = useState<Record<SegKey, number>>({
    strength_swim: 0,
    strength_t1: 0,
    strength_bike: 0,
    strength_t2: 0,
    strength_run: 0,
  })

  const hasSegStrengths = SEGS.every((s) => athlete[s.key] != null)
  const totalDelta = useMemo(
    () => Object.values(deltas).reduce((a, b) => a + b, 0),
    [deltas],
  )

  // 元の strength と新 strength
  const origStrength = athlete.strength ?? null
  const simStrength = origStrength != null ? origStrength + totalDelta : null

  // 元の順位と新順位（カテゴリランキングを使用）
  const { origRank, simRank, totalAthletes } = useMemo(() => {
    if (!rankings || origStrength == null || simStrength == null) {
      return { origRank: null, simRank: null, totalAthletes: 0 }
    }
    const others = rankings.filter((r) => r.athlete_id !== athlete.athlete_id)
    const total = others.length + 1
    // 元の順位 = 自分より strength が小さい (速い) 選手数 + 1
    let origR = 1
    let simR = 1
    for (const r of others) {
      if (r.strength == null) continue
      if (r.strength < origStrength) origR++
      if (r.strength < simStrength) simR++
    }
    return { origRank: origR, simRank: simR, totalAthletes: total }
  }, [rankings, origStrength, simStrength, athlete.athlete_id])

  // セグメント別新順位
  const segNewRanks = useMemo(() => {
    if (!rankings) return null
    const out: Record<SegKey, { orig: number | null; sim: number | null }> = {} as never
    for (const seg of SEGS) {
      const origVal = athlete[seg.key] as number | null
      const simVal = origVal != null ? origVal + deltas[seg.key] : null
      let origR: number | null = null
      let simR: number | null = null
      if (origVal != null) {
        origR = 1
        simR = 1
        for (const r of rankings) {
          if (r.athlete_id === athlete.athlete_id) continue
          const v = r[seg.key] as number | null | undefined
          if (v == null) continue
          if (v < origVal) origR++
          if (simVal != null && v < simVal) simR++
        }
      }
      out[seg.key] = { orig: origR, sim: simR }
    }
    return out
  }, [rankings, athlete, deltas])

  if (!hasSegStrengths) {
    return (
      <div className="whatif-empty">
        セグメント別の強度データが不足しているため、What-if シミュレーションは利用できません。
      </div>
    )
  }

  const reset = () => setDeltas({
    strength_swim: 0, strength_t1: 0, strength_bike: 0, strength_t2: 0, strength_run: 0,
  })

  const rankDelta = origRank != null && simRank != null ? origRank - simRank : null
  const timeDelta = totalDelta

  return (
    <div className="whatif-card">
      <div className="whatif-header">
        <div>
          <h3 className="whatif-title">🧮 What-if シミュレータ</h3>
          <p className="whatif-desc">
            各セグメントを動かすと、合計タイムと予想順位がリアルタイムで再計算されます。
            「Bike を 30秒縮めたら何位まで上がる？」を試せます。
          </p>
        </div>
        <button className="whatif-reset" onClick={reset} disabled={totalDelta === 0}>
          リセット
        </button>
      </div>

      {/* サマリ表示 */}
      <div className="whatif-summary">
        <div className="whatif-summary-item">
          <div className="whatif-summary-label">合計タイム（標準化）</div>
          <div className="whatif-summary-value">
            <span className="whatif-orig">{formatTime(origStrength)}</span>
            <span className="whatif-arrow">→</span>
            <span className={`whatif-sim${timeDelta < 0 ? ' whatif-improved' : timeDelta > 0 ? ' whatif-worsened' : ''}`}>
              {formatTime(simStrength)}
            </span>
            {timeDelta !== 0 && (
              <span className={`whatif-delta${timeDelta < 0 ? ' whatif-improved' : ' whatif-worsened'}`}>
                {fmtDelta(timeDelta)}
              </span>
            )}
          </div>
        </div>
        <div className="whatif-summary-item">
          <div className="whatif-summary-label">予想順位（カテゴリ内）</div>
          <div className="whatif-summary-value">
            <span className="whatif-orig">{origRank ?? '—'}位</span>
            <span className="whatif-arrow">→</span>
            <span className={`whatif-sim whatif-rank${rankDelta != null && rankDelta > 0 ? ' whatif-improved' : rankDelta != null && rankDelta < 0 ? ' whatif-worsened' : ''}`}>
              {simRank ?? '—'}位
            </span>
            {rankDelta != null && rankDelta !== 0 && (
              <span className={`whatif-delta${rankDelta > 0 ? ' whatif-improved' : ' whatif-worsened'}`}>
                {rankDelta > 0 ? `↑${rankDelta}位` : `↓${Math.abs(rankDelta)}位`}
              </span>
            )}
            <span className="whatif-total">/ {totalAthletes}人</span>
          </div>
        </div>
      </div>

      {/* スライダー */}
      <div className="whatif-sliders">
        {SEGS.map((seg) => {
          const origVal = athlete[seg.key] as number | null
          const d = deltas[seg.key]
          const simVal = origVal != null ? origVal + d : null
          const segRanks = segNewRanks?.[seg.key]
          return (
            <div key={seg.key} className="whatif-slider-row">
              <div className="whatif-slider-info">
                <span className="whatif-slider-label">
                  <span className="whatif-slider-icon">{seg.icon}</span>
                  {seg.label}
                </span>
                <span className="whatif-slider-values">
                  <span className="whatif-slider-orig">{formatTime(origVal)}</span>
                  <span className="whatif-slider-arrow">→</span>
                  <span className={`whatif-slider-sim${d < 0 ? ' whatif-improved' : d > 0 ? ' whatif-worsened' : ''}`}>
                    {formatTime(simVal)}
                  </span>
                  {segRanks && segRanks.orig != null && segRanks.sim != null && (
                    <span className="whatif-slider-rank">
                      ({segRanks.orig}位
                      {segRanks.sim !== segRanks.orig && (
                        <span className={segRanks.sim < segRanks.orig ? 'whatif-improved' : 'whatif-worsened'}>
                          {' '}→ {segRanks.sim}位
                        </span>
                      )}
                      )
                    </span>
                  )}
                </span>
              </div>
              <div className="whatif-slider-control">
                <input
                  type="range"
                  min={seg.min}
                  max={seg.max}
                  step={1}
                  value={d}
                  onChange={(e) => setDeltas((prev) => ({ ...prev, [seg.key]: Number(e.target.value) }))}
                  style={{ accentColor: seg.color }}
                  className="whatif-slider"
                />
                <span className="whatif-slider-delta">{fmtDelta(d)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {!rankings && (
        <p className="whatif-note">同カテゴリのランキングを取得中… 順位再計算は取得後に有効になります。</p>
      )}
    </div>
  )
}
