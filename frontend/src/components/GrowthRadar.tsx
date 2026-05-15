import { useMemo, useState } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, ResponsiveContainer, Tooltip,
} from 'recharts'
import { formatTime, type RankingEntry, type AthleteDetail } from '../api'
import './GrowthRadar.css'

type SegKey = 'strength' | 'strength_swim' | 'strength_t1' | 'strength_bike' | 'strength_t2' | 'strength_run'

const SEGS: { key: SegKey; label: string; icon: string; color: string }[] = [
  { key: 'strength_swim', label: 'Swim', icon: '🏊', color: '#38bdf8' },
  { key: 'strength_t1',   label: 'T1',   icon: '⚡', color: '#c4b5fd' },
  { key: 'strength_bike', label: 'Bike', icon: '🚴', color: '#fb923c' },
  { key: 'strength_t2',   label: 'T2',   icon: '🔄', color: '#f9a8d4' },
  { key: 'strength_run',  label: 'Run',  icon: '🏃', color: '#4ade80' },
]

interface SegStats {
  key: SegKey
  label: string
  icon: string
  color: string
  athleteValue: number | null
  athleteRank: number | null
  total: number
  top3Avg: number | null
  top10Avg: number | null
  gapToTop3: number | null
  gapToTop10: number | null
  percentile: number | null // 0-100, higher = faster
}

function computeStats(
  rankings: RankingEntry[],
  athleteId: string,
): SegStats[] {
  return SEGS.map((seg) => {
    const values: { athleteId: string; value: number }[] = []
    for (const r of rankings) {
      const v = r[seg.key] as number | null | undefined
      if (v != null) values.push({ athleteId: r.athlete_id, value: v })
    }
    values.sort((a, b) => a.value - b.value)
    const total = values.length
    const athleteIdx = values.findIndex((v) => v.athleteId === athleteId)
    const athleteValue = athleteIdx >= 0 ? values[athleteIdx].value : null
    const athleteRank = athleteIdx >= 0 ? athleteIdx + 1 : null
    const top3 = values.slice(0, 3)
    const top10 = values.slice(0, 10)
    const top3Avg = top3.length > 0 ? top3.reduce((s, v) => s + v.value, 0) / top3.length : null
    const top10Avg = top10.length > 0 ? top10.reduce((s, v) => s + v.value, 0) / top10.length : null

    return {
      key: seg.key,
      label: seg.label,
      icon: seg.icon,
      color: seg.color,
      athleteValue,
      athleteRank,
      total,
      top3Avg,
      top10Avg,
      gapToTop3: athleteValue != null && top3Avg != null ? athleteValue - top3Avg : null,
      gapToTop10: athleteValue != null && top10Avg != null ? athleteValue - top10Avg : null,
      percentile: athleteRank != null && total > 0
        ? Math.round((1 - (athleteRank - 1) / Math.max(1, total - 1)) * 100)
        : null,
    }
  })
}

function fmtSec(s: number | null): string {
  if (s == null) return '—'
  const sign = s >= 0 ? '+' : '-'
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const ss = Math.round(abs % 60)
  if (m === 0) return `${sign}${ss}秒`
  return `${sign}${m}:${String(ss).padStart(2, '0')}`
}

export function GrowthCards({ athlete, rankings }: { athlete: AthleteDetail; rankings: RankingEntry[] | null }) {
  const stats = useMemo(
    () => rankings ? computeStats(rankings, athlete.athlete_id) : null,
    [rankings, athlete.athlete_id],
  )

  if (!stats) {
    return <div className="growth-cards-loading">同カテゴリのランキングを取得中…</div>
  }

  // 最大の伸び代 = TOP3まで最もギャップが大きいセグメント
  const opportunity = stats.reduce<SegStats | null>((max, s) => {
    if (s.gapToTop3 == null) return max
    if (max == null || (max.gapToTop3 ?? 0) < s.gapToTop3) return s
    return max
  }, null)

  // 最大の強み = 最もパーセンタイルが高いセグメント
  const strength = stats.reduce<SegStats | null>((best, s) => {
    if (s.percentile == null) return best
    if (best == null || (best.percentile ?? 0) < s.percentile) return s
    return best
  }, null)

  return (
    <div className="growth-section">
      <div className="growth-headline">
        <h3 className="growth-title">📈 伸び代分析（同カテゴリTOP比較）</h3>
        {strength && opportunity && (
          <div className="growth-summary">
            最大の強み:&nbsp;
            <strong style={{ color: strength.color }}>{strength.icon} {strength.label}</strong>
            （{strength.percentile != null ? `上位${100 - strength.percentile}%` : '—'}）
            <span className="growth-summary-sep">／</span>
            最大の伸び代:&nbsp;
            <strong style={{ color: opportunity.color }}>{opportunity.icon} {opportunity.label}</strong>
            （TOP3まで {fmtSec(opportunity.gapToTop3)}）
          </div>
        )}
      </div>

      <div className="growth-cards-grid">
        {stats.map((s) => {
          const isOpportunity = opportunity?.key === s.key
          const isStrength = strength?.key === s.key
          const meterPct = Math.max(0, Math.min(100, s.percentile ?? 0))
          return (
            <div
              key={s.key}
              className={`growth-card${isOpportunity ? ' growth-card-opportunity' : ''}${isStrength ? ' growth-card-strength' : ''}`}
              style={{ borderTopColor: s.color }}
            >
              <div className="growth-card-header">
                <span className="growth-card-icon">{s.icon}</span>
                <span className="growth-card-label">{s.label}</span>
                {isStrength && <span className="growth-badge growth-badge-strength">強み</span>}
                {isOpportunity && !isStrength && <span className="growth-badge growth-badge-opportunity">伸び代</span>}
              </div>

              <div className="growth-card-time">{formatTime(s.athleteValue ?? null)}</div>
              <div className="growth-card-rank">
                {s.athleteRank != null ? <>カテゴリ内 <strong>{s.athleteRank}位</strong>/{s.total}人</> : '—'}
              </div>

              {s.percentile != null && (
                <div className="growth-meter" title={`上位${100 - s.percentile}%`}>
                  <div
                    className="growth-meter-fill"
                    style={{ width: `${meterPct}%`, background: s.color }}
                  />
                  <div className="growth-meter-marker growth-meter-top10" style={{ left: '80%' }} title="TOP10" />
                  <div className="growth-meter-marker growth-meter-top3"  style={{ left: '95%' }} title="TOP3" />
                </div>
              )}

              <div className="growth-card-gaps">
                <div className="growth-gap-row">
                  <span className="growth-gap-label">TOP3 まで</span>
                  <span className={`growth-gap-value${(s.gapToTop3 ?? 0) > 0 ? ' growth-gap-behind' : ' growth-gap-ahead'}`}>
                    {s.gapToTop3 == null ? '—' : (s.gapToTop3 > 0 ? `あと ${fmtSec(s.gapToTop3).replace('+','')}` : `先行 ${fmtSec(s.gapToTop3).replace('-','')}`)}
                  </span>
                </div>
                <div className="growth-gap-row">
                  <span className="growth-gap-label">TOP10 まで</span>
                  <span className={`growth-gap-value${(s.gapToTop10 ?? 0) > 0 ? ' growth-gap-behind' : ' growth-gap-ahead'}`}>
                    {s.gapToTop10 == null ? '—' : (s.gapToTop10 > 0 ? `あと ${fmtSec(s.gapToTop10).replace('+','')}` : `先行 ${fmtSec(s.gapToTop10).replace('-','')}`)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SegmentRadar({ athlete, rankings }: { athlete: AthleteDetail; rankings: RankingEntry[] | null }) {
  const [showTop10, setShowTop10] = useState(true)
  const data = useMemo(() => {
    if (!rankings) return []
    const stats = computeStats(rankings, athlete.athlete_id)
    return stats.map((s) => ({
      segment: `${s.icon} ${s.label}`,
      自分: s.percentile ?? 0,
      'TOP10ライン': 80,
      key: s.key,
    }))
  }, [rankings, athlete.athlete_id])

  if (!rankings) return null
  if (data.every((d) => d.自分 === 0)) return null

  return (
    <div className="radar-card">
      <div className="radar-header">
        <h3 className="radar-title">🕸 セグメント別ポジショニング（カテゴリ内パーセンタイル）</h3>
        <label className="radar-toggle">
          <input type="checkbox" checked={showTop10} onChange={(e) => setShowTop10(e.target.checked)} />
          <span>TOP10ライン表示</span>
        </label>
      </div>
      <p className="radar-desc">
        各セグメントで <strong>カテゴリ内で何%の選手より速いか</strong> を表示。外側ほど強い。
        TOP10ラインは「上位約20%」の目安です。
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} outerRadius="78%">
          <PolarGrid strokeOpacity={0.4} />
          <PolarAngleAxis dataKey="segment" tick={{ fontSize: 12, fill: 'var(--text)' }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickCount={6} />
          {showTop10 && (
            <Radar
              name="TOP10ライン"
              dataKey="TOP10ライン"
              stroke="#94a3b8"
              fill="#94a3b8"
              fillOpacity={0.15}
              strokeDasharray="4 4"
            />
          )}
          <Radar
            name="自分"
            dataKey="自分"
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.35}
            strokeWidth={2}
          />
          <Tooltip
            formatter={(v: number, name: string) => [`${v}%`, name === '自分' ? '上回り' : name]}
            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: '0.85rem', borderRadius: '8px' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
