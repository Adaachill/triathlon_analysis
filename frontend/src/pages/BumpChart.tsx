import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { formatTime } from '../api'

/**
 * X positions in a normalized 0-8 coordinate space.
 * Main segments (Swim/Bike/Run) get width 2, transitions (T1/T2) get width 1.
 */
const CHECKPOINTS = [
  { key: 'start',  label: 'Start',  xPos: 0 },
  { key: 'swim',   label: 'Swim',   xPos: 2 },
  { key: 't1',     label: 'T1',     xPos: 3 },
  { key: 'bike',   label: 'Bike',   xPos: 5 },
  { key: 't2',     label: 'T2',     xPos: 6 },
  { key: 'finish', label: 'Finish', xPos: 8 },
] as const

const PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#10b981',
  '#fb923c', '#7c3aed', '#0d9488', '#dc2626', '#2563eb',
]

/** BumpChart に渡す統一済みの選手データ */
export interface BumpAthleteInput {
  athlete_id: string
  first_name: string
  last_name: string
  country: string
  swim_sec: number
  t1_sec: number
  bike_sec: number
  t2_sec: number
  run_sec: number
}

interface CheckpointData {
  key: string
  label: string
  xPos: number
  rank: number
  cumTime: number
  segTime: number
  /** rank[i] - rank[i-1]; 0 for Start and Swim (first real ranking) */
  rankDelta: number
}

interface AthleteChartData {
  input: BumpAthleteInput
  color: string
  checkpoints: CheckpointData[]
}

interface TooltipState {
  x: number
  y: number
  athleteName: string
  cp: CheckpointData
  above: { name: string; gap: number } | null
  below: { name: string; gap: number } | null
}

export default function BumpChart({ athletes }: { athletes: BumpAthleteInput[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [modal, setModal] = useState<AthleteChartData | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const chartData = useMemo<AthleteChartData[]>(() => {
    if (athletes.length < 2) return []

    const withCum = athletes.map((a, i) => {
      const segs = [a.swim_sec, a.t1_sec, a.bike_sec, a.t2_sec, a.run_sec]
      let cum = 0
      const cumTimes = segs.map((s) => { cum += s; return cum })
      return { input: a, color: PALETTE[i % PALETTE.length], segs, cumTimes }
    })

    // Rank maps for each of the 5 real checkpoints (Swim, T1, Bike, T2, Finish)
    const rankMaps = Array.from({ length: 5 }, (_, ci) => {
      const sorted = [...withCum].sort((a, b) => a.cumTimes[ci] - b.cumTimes[ci])
      return new Map(sorted.map((d, rank) => [d.input.athlete_id, rank + 1]))
    })

    return withCum.map((d) => {
      const segKeys  = ['swim', 't1', 'bike', 't2', 'finish']
      const xPositions = [2, 3, 5, 6, 8]

      const realCps: CheckpointData[] = segKeys.map((key, ci) => {
        const rank     = rankMaps[ci].get(d.input.athlete_id) ?? athletes.length
        // rankDelta: compare vs previous segment rank; at Swim compare vs Start (rank=1 for all)
        const prevRank = ci === 0 ? 1 : (rankMaps[ci - 1].get(d.input.athlete_id) ?? athletes.length)
        return {
          key,
          label: CHECKPOINTS[ci + 1].label,
          xPos: xPositions[ci],
          rank,
          cumTime: d.cumTimes[ci],
          segTime: d.segs[ci],
          // Swim gets delta 0 — first real ranking from neutral start is not a "change"
          rankDelta: ci === 0 ? 0 : rank - prevRank,
        }
      })

      return {
        input: d.input,
        color: d.color,
        checkpoints: [
          { key: 'start', label: 'Start', xPos: 0, rank: 1, cumTime: 0, segTime: 0, rankDelta: 0 },
          ...realCps,
        ],
      }
    })
  }, [athletes])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length < 2) return

    const container = containerRef.current

    const draw = (containerWidth: number) => {
      if (!svgRef.current || containerWidth <= 0) return

      const margin = { top: 28, right: 60, bottom: 40, left: 36 }
      const width  = containerWidth - margin.left - margin.right
      const n      = chartData.length
      const rowH   = Math.max(18, Math.min(30, Math.floor(300 / n)))
      const height = rowH * n

      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()
      svg.attr('width', containerWidth).attr('height', height + margin.top + margin.bottom)

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

      // X: normalized 0-8 space
      const xScale = d3.scaleLinear().domain([0, 8]).range([0, width])
      // Y: rank 1 at top
      const yScale = d3.scaleLinear().domain([0.5, n + 0.5]).range([0, height])

      // Background stripe for T1/T2 (narrow segments)
      ;[[3, 1], [6, 1]].forEach(([xPos, w]) => {
        g.append('rect')
          .attr('x', xScale(xPos - w)).attr('y', 0)
          .attr('width', xScale(xPos) - xScale(xPos - w))
          .attr('height', height)
          .attr('fill', 'var(--bg-hover, rgba(255,255,255,0.03))')
          .attr('opacity', 0.5)
      })

      // Vertical lines + labels for each checkpoint
      CHECKPOINTS.forEach(({ label, xPos }) => {
        const x = xScale(xPos)
        g.append('line')
          .attr('x1', x).attr('x2', x)
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', 'var(--border)')
          .attr('stroke-dasharray', xPos === 0 ? 'none' : '4,4')
          .attr('stroke-width', 1)
        g.append('text')
          .attr('x', x).attr('y', height + 22)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--text-muted)')
          .style('font-size', '0.75rem')
          .text(label)
      })

      // Y-axis rank numbers
      for (let rank = 1; rank <= n; rank++) {
        g.append('text')
          .attr('x', -8).attr('y', yScale(rank) + 4)
          .attr('text-anchor', 'end')
          .style('fill', 'var(--text-muted)')
          .style('font-size', '0.68rem')
          .text(rank)
      }

      const lineGen = d3.line<CheckpointData>()
        .x((d) => xScale(d.xPos))
        .y((d) => yScale(d.rank))
        .curve(d3.curveCatmullRom.alpha(0.5))

      const ANIM_MS = 1400

      chartData.forEach((d) => {
        // Animated path
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
          .on('mouseout',  function () { d3.select(this).attr('stroke-width', 2.5).attr('stroke-opacity', 0.85) })

        const pathNode = pathEl.node() as SVGPathElement | null
        const totalLen = pathNode ? (() => { try { return pathNode.getTotalLength() } catch { return 0 } })() : 0
        if (totalLen > 0) {
          pathEl
            .attr('stroke-dasharray', `${totalLen} ${totalLen}`)
            .attr('stroke-dashoffset', totalLen)
            .transition().duration(ANIM_MS).ease(d3.easeLinear)
            .attr('stroke-dashoffset', 0)
        }

        // Dots + rank-change indicators
        d.checkpoints.forEach((cp, ci) => {
          const cx = xScale(cp.xPos)
          const cy = yScale(cp.rank)
          const improved = cp.rankDelta < 0   // rank number dropped → moved UP
          const worsened = cp.rankDelta > 0

          const dotColor  = improved ? '#22c55e' : worsened ? '#ef4444' : d.color
          const dotRadius = (improved || worsened) ? 7 : 5
          const ringColor = (improved || worsened) ? 'rgba(255,255,255,0.9)' : 'var(--bg-card,#1a1a2e)'

          const showTooltip = (clientX: number, clientY: number) => {
            const atCp = chartData
              .map((ad) => ({
                id:      ad.input.athlete_id,
                name:    ad.input.last_name || ad.input.athlete_id,
                rank:    ad.checkpoints[ci].rank,
                cumTime: ad.checkpoints[ci].cumTime,
              }))
              .sort((a, b) => a.rank - b.rank)
            const myIdx = atCp.findIndex((x) => x.id === d.input.athlete_id)
            const above = myIdx > 0 ? atCp[myIdx - 1] : null
            const below = myIdx < atCp.length - 1 ? atCp[myIdx + 1] : null
            const rect  = container.getBoundingClientRect()
            setTooltip({
              x: clientX - rect.left,
              y: clientY - rect.top,
              athleteName: `${d.input.first_name} ${d.input.last_name}`.trim(),
              cp,
              above: above && cp.key !== 'start' ? { name: above.name, gap: cp.cumTime - above.cumTime } : null,
              below: below && cp.key !== 'start' ? { name: below.name, gap: below.cumTime - cp.cumTime } : null,
            })
          }

          g.append('circle')
            .attr('cx', cx).attr('cy', cy)
            .attr('r', dotRadius)
            .attr('fill', dotColor)
            .attr('stroke', ringColor)
            .attr('stroke-width', (improved || worsened) ? 2 : 1.5)
            .attr('opacity', 0)
            .style('cursor', 'pointer')
            .on('click', () => setModal(d))
            .on('mousemove', (event: MouseEvent) => {
              showTooltip(event.clientX, event.clientY)
            })
            .on('mouseout', () => setTooltip(null))
            .on('touchstart', (event: TouchEvent) => {
              event.preventDefault()
              const touch = event.touches[0]
              if (touch) showTooltip(touch.clientX, touch.clientY)
            }, { passive: false })
            .on('touchend', () => setTooltip(null))
            .transition().delay(ANIM_MS).duration(200).attr('opacity', 1)

          // Arrow label above dot for rank changes (T1 onwards only)
          if (improved || worsened) {
            const arrow    = improved ? '↑' : '↓'
            const absDelta = Math.abs(cp.rankDelta)
            g.append('text')
              .attr('x', cx).attr('y', cy - dotRadius - 3)
              .attr('text-anchor', 'middle')
              .style('fill', improved ? '#22c55e' : '#ef4444')
              .style('font-size', '0.62rem')
              .style('font-weight', '700')
              .attr('opacity', 0)
              .text(`${arrow}${absDelta}`)
              .transition().delay(ANIM_MS).duration(200).attr('opacity', 1)
          }
        })

        // Finish rank label on right edge
        const fin = d.checkpoints[d.checkpoints.length - 1]
        g.append('text')
          .attr('x', xScale(fin.xPos) + 9).attr('y', yScale(fin.rank) + 4)
          .style('fill', d.color).style('font-size', '0.7rem').style('font-weight', '700')
          .attr('opacity', 0)
          .text(fin.rank)
          .transition().delay(ANIM_MS).duration(200).attr('opacity', 1)
      })
    }

    // ResizeObserver で幅変化を監視し、iOS で clientWidth=0 から正常値に変わった時も描画する
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0)
      draw(width)
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [chartData])

  if (chartData.length < 2) return null

  return (
    <div className="bump-chart-card">
      <div className="bump-chart-header">
        <span className="bump-chart-title">順位変動チャート</span>
        <span className="bump-chart-hint">ラインをクリックすると詳細表示　🟢↑昇順　🔴↓降順</span>
      </div>

      <div className="bump-chart-body" ref={containerRef}>
        {tooltip && (
          <div className="bump-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
            <div className="bump-tt-name">{tooltip.athleteName}</div>
            {tooltip.cp.key === 'start' ? (
              <div className="bump-tt-row">スタート — 全員同位置</div>
            ) : (
              <>
                <div className="bump-tt-row">
                  {tooltip.cp.label} 終了時点&nbsp;<strong>{tooltip.cp.rank}位</strong>
                  {tooltip.cp.rankDelta !== 0 && (
                    <span style={{ color: tooltip.cp.rankDelta < 0 ? '#22c55e' : '#ef4444', marginLeft: '0.4rem' }}>
                      {tooltip.cp.rankDelta < 0 ? `↑${Math.abs(tooltip.cp.rankDelta)}` : `↓${tooltip.cp.rankDelta}`}
                    </span>
                  )}
                </div>
                <div className="bump-tt-row bump-tt-time">累積: {formatTime(tooltip.cp.cumTime)}</div>
                {tooltip.above && (
                  <div className="bump-tt-row bump-tt-above">▲ {tooltip.above.name}: {formatTime(tooltip.above.gap)} 差</div>
                )}
                {tooltip.below && (
                  <div className="bump-tt-row bump-tt-below">▼ {tooltip.below.name}: {formatTime(tooltip.below.gap)} 差</div>
                )}
              </>
            )}
          </div>
        )}
        <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      </div>

      <div className="bump-legend">
        {chartData.map((d) => (
          <button
            key={d.input.athlete_id}
            className="bump-legend-item"
            onClick={() => setModal(d)}
            title="クリックして詳細を表示"
          >
            <span className="bump-legend-dot" style={{ background: d.color }} />
            <span>{d.input.first_name} {d.input.last_name}</span>
          </button>
        ))}
      </div>

      {modal && (
        <div className="bump-modal-overlay" onClick={() => setModal(null)}>
          <div className="bump-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bump-modal-header" style={{ borderLeftColor: modal.color }}>
              <div>
                <div className="bump-modal-athlete">
                  {modal.input.first_name} {modal.input.last_name}
                </div>
                <div className="bump-modal-meta">{modal.input.country}</div>
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
                  <th>変動</th>
                </tr>
              </thead>
              <tbody>
                {modal.checkpoints.filter((cp) => cp.key !== 'start').map((cp) => (
                  <tr key={cp.key}>
                    <td>{cp.label}</td>
                    <td className="mono">{formatTime(cp.segTime)}</td>
                    <td className="mono">{formatTime(cp.cumTime)}</td>
                    <td><strong style={{ color: modal.color }}>{cp.rank}位</strong></td>
                    <td>
                      {cp.rankDelta === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : cp.rankDelta < 0 ? (
                        <span style={{ color: '#22c55e', fontWeight: 700 }}>↑{Math.abs(cp.rankDelta)}</span>
                      ) : (
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>↓{cp.rankDelta}</span>
                      )}
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
