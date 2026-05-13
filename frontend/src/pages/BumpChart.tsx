import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import type { PredictAthlete } from '../api'
import { formatTime } from '../api'

const CHECKPOINT_KEYS = ['swim', 't1', 'bike', 't2', 'run'] as const
const CHECKPOINT_LABELS = ['Swim', 'T1', 'Bike', 'T2', 'Finish'] as const

const PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#10b981',
  '#fb923c', '#7c3aed', '#0d9488', '#dc2626', '#2563eb',
]

interface CheckpointInfo {
  label: string
  key: string
  cumTime: number
  rank: number
  segTime: number
}

interface AthleteChartData {
  athlete: PredictAthlete
  color: string
  checkpoints: CheckpointInfo[]
}

interface TooltipState {
  x: number
  y: number
  athleteName: string
  checkpoint: CheckpointInfo
  above: { name: string; gap: number } | null
  below: { name: string; gap: number } | null
}

interface Props {
  athletes: PredictAthlete[]
}

export default function BumpChart({ athletes }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [modal, setModal] = useState<AthleteChartData | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const chartData = useMemo<AthleteChartData[]>(() => {
    const eligible = athletes.filter(
      (a) =>
        a.has_history &&
        a.pred_avg.swim_sec != null &&
        a.pred_avg.t1_sec != null &&
        a.pred_avg.bike_sec != null &&
        a.pred_avg.t2_sec != null &&
        a.pred_avg.run_sec != null,
    )

    const withCum = eligible.map((a, i) => {
      const p = a.pred_avg
      const segs = [p.swim_sec!, p.t1_sec!, p.bike_sec!, p.t2_sec!, p.run_sec!]
      let cum = 0
      const cumTimes = segs.map((s) => { cum += s; return cum })
      return { athlete: a, color: PALETTE[i % PALETTE.length], segs, cumTimes }
    })

    const rankMaps = Array.from({ length: 5 }, (_, ci) => {
      const sorted = [...withCum].sort((a, b) => a.cumTimes[ci] - b.cumTimes[ci])
      return new Map(sorted.map((d, rank) => [d.athlete.athlete_id, rank + 1]))
    })

    return withCum.map((d) => ({
      athlete: d.athlete,
      color: d.color,
      checkpoints: CHECKPOINT_LABELS.map((label, ci) => ({
        label,
        key: CHECKPOINT_KEYS[ci],
        cumTime: d.cumTimes[ci],
        rank: rankMaps[ci].get(d.athlete.athlete_id) ?? d.segs.length,
        segTime: d.segs[ci],
      })),
    }))
  }, [athletes])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length < 2) return

    const containerWidth = containerRef.current.clientWidth
    const margin = { top: 24, right: 56, bottom: 40, left: 36 }
    const width = containerWidth - margin.left - margin.right
    const n = chartData.length
    const rowH = Math.max(18, Math.min(30, Math.floor(300 / n)))
    const height = rowH * n

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', containerWidth).attr('height', height + margin.top + margin.bottom)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // X scale: use median cumulative time at each checkpoint to preserve proportionality
    const medians = CHECKPOINT_LABELS.map((_, ci) => {
      const times = chartData.map((d) => d.checkpoints[ci].cumTime).sort((a, b) => a - b)
      return times[Math.floor(times.length / 2)]
    })
    const xScale = d3.scaleLinear()
      .domain([0, medians[medians.length - 1] * 1.02])
      .range([0, width])

    // Y scale: rank 1 at top
    const yScale = d3.scaleLinear()
      .domain([0.5, n + 0.5])
      .range([0, height])

    // Checkpoint vertical lines and labels
    CHECKPOINT_LABELS.forEach((label, ci) => {
      const x = xScale(medians[ci])
      g.append('line')
        .attr('x1', x).attr('x2', x)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', 'var(--border)')
        .attr('stroke-dasharray', '4,4')
        .attr('stroke-width', 1)

      g.append('text')
        .attr('x', x).attr('y', height + 22)
        .attr('text-anchor', 'middle')
        .style('fill', 'var(--text-muted)')
        .style('font-size', '0.75rem')
        .text(label)
    })

    // Y axis rank numbers
    for (let rank = 1; rank <= n; rank++) {
      g.append('text')
        .attr('x', -8).attr('y', yScale(rank) + 4)
        .attr('text-anchor', 'end')
        .style('fill', 'var(--text-muted)')
        .style('font-size', '0.68rem')
        .text(rank)
    }

    // Line generator with smooth curve
    const lineGen = d3.line<CheckpointInfo>()
      .x((d) => xScale(d.cumTime))
      .y((d) => yScale(d.rank))
      .curve(d3.curveCatmullRom.alpha(0.5))

    const ANIM_DURATION = 1400

    chartData.forEach((d) => {
      // Line path with draw animation
      const pathEl = g.append('path')
        .datum(d.checkpoints)
        .attr('fill', 'none')
        .attr('stroke', d.color)
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-opacity', 0.85)
        .attr('d', lineGen)
        .style('cursor', 'pointer')
        .on('click', () => setModal(d))
        .on('mouseover', function () { d3.select(this).attr('stroke-width', 4).attr('stroke-opacity', 1) })
        .on('mouseout', function () { d3.select(this).attr('stroke-width', 2.5).attr('stroke-opacity', 0.85) })

      const totalLength = (pathEl.node() as SVGPathElement).getTotalLength()
      pathEl
        .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
        .attr('stroke-dashoffset', totalLength)
        .transition()
        .duration(ANIM_DURATION)
        .ease(d3.easeLinear)
        .attr('stroke-dashoffset', 0)

      // Dots at each checkpoint
      d.checkpoints.forEach((cp, ci) => {
        g.append('circle')
          .attr('cx', xScale(cp.cumTime))
          .attr('cy', yScale(cp.rank))
          .attr('r', 5)
          .attr('fill', d.color)
          .attr('stroke', 'var(--bg-card, #1a1a2e)')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0)
          .style('cursor', 'pointer')
          .on('click', () => setModal(d))
          .on('mousemove', (event: MouseEvent) => {
            const atCp = chartData
              .map((ad) => ({
                id: ad.athlete.athlete_id,
                name: ad.athlete.last_name || ad.athlete.athlete_id,
                rank: ad.checkpoints[ci].rank,
                cumTime: ad.checkpoints[ci].cumTime,
              }))
              .sort((a, b) => a.rank - b.rank)
            const myIdx = atCp.findIndex((x) => x.id === d.athlete.athlete_id)
            const above = myIdx > 0 ? atCp[myIdx - 1] : null
            const below = myIdx < atCp.length - 1 ? atCp[myIdx + 1] : null
            const rect = containerRef.current!.getBoundingClientRect()
            setTooltip({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              athleteName: `${d.athlete.first_name} ${d.athlete.last_name}`.trim(),
              checkpoint: cp,
              above: above ? { name: above.name, gap: cp.cumTime - above.cumTime } : null,
              below: below ? { name: below.name, gap: below.cumTime - cp.cumTime } : null,
            })
          })
          .on('mouseout', () => setTooltip(null))
          .transition()
          .delay(ANIM_DURATION)
          .duration(200)
          .attr('opacity', 1)
      })

      // Rank label at finish
      const fin = d.checkpoints[d.checkpoints.length - 1]
      g.append('text')
        .attr('x', xScale(fin.cumTime) + 9)
        .attr('y', yScale(fin.rank) + 4)
        .style('fill', d.color)
        .style('font-size', '0.7rem')
        .style('font-weight', '700')
        .attr('opacity', 0)
        .text(fin.rank)
        .transition()
        .delay(ANIM_DURATION)
        .duration(200)
        .attr('opacity', 1)
    })
  }, [chartData])

  if (chartData.length < 2) return null

  return (
    <div className="bump-chart-card">
      <div className="bump-chart-header">
        <span className="bump-chart-title">順位変動チャート</span>
        <span className="bump-chart-hint">ラインをクリックすると詳細表示</span>
      </div>

      <div className="bump-chart-body" ref={containerRef}>
        {tooltip && (
          <div
            className="bump-tooltip"
            style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
          >
            <div className="bump-tt-name">{tooltip.athleteName}</div>
            <div className="bump-tt-row">
              {tooltip.checkpoint.label} 終了時点&nbsp;
              <strong>{tooltip.checkpoint.rank}位</strong>
            </div>
            <div className="bump-tt-row bump-tt-time">
              累積: {formatTime(tooltip.checkpoint.cumTime)}
            </div>
            {tooltip.above && (
              <div className="bump-tt-row bump-tt-above">
                ▲ {tooltip.above.name}: {formatTime(tooltip.above.gap)} 差
              </div>
            )}
            {tooltip.below && (
              <div className="bump-tt-row bump-tt-below">
                ▼ {tooltip.below.name}: {formatTime(tooltip.below.gap)} 差
              </div>
            )}
          </div>
        )}
        <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      </div>

      <div className="bump-legend">
        {chartData.map((d) => (
          <button
            key={d.athlete.athlete_id}
            className="bump-legend-item"
            onClick={() => setModal(d)}
            title="クリックして詳細を表示"
          >
            <span className="bump-legend-dot" style={{ background: d.color }} />
            <span>{d.athlete.first_name} {d.athlete.last_name}</span>
          </button>
        ))}
      </div>

      {modal && (
        <div className="bump-modal-overlay" onClick={() => setModal(null)}>
          <div className="bump-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bump-modal-header" style={{ borderLeftColor: modal.color }}>
              <div>
                <div className="bump-modal-athlete">
                  {modal.athlete.first_name} {modal.athlete.last_name}
                </div>
                <div className="bump-modal-meta">
                  {modal.athlete.country} · {modal.athlete.program_name}
                </div>
              </div>
              <button className="bump-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <table className="bump-modal-table">
              <thead>
                <tr>
                  <th>セグメント</th>
                  <th>区間タイム</th>
                  <th>累積タイム</th>
                  <th>順位</th>
                </tr>
              </thead>
              <tbody>
                {modal.checkpoints.map((cp) => (
                  <tr key={cp.key}>
                    <td>{cp.label}</td>
                    <td className="mono">{formatTime(cp.segTime)}</td>
                    <td className="mono">{formatTime(cp.cumTime)}</td>
                    <td>
                      <strong style={{ color: modal.color }}>{cp.rank}位</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
