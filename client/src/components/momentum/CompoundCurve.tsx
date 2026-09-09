import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { format, addWeeks, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  progressSeries, activeDaysPerWeek, projectFan, project,
  formatMultiplier, type Point, type ProjectedPoint,
} from '@/lib/compound'
import type { Momentum } from '@/types'

// The range looks the same distance forward as back. It has to: y-max is driven
// by where the projection ends, so a fixed 1-year projection would flatten the
// history you actually earned into a smudge on the floor no matter how far back
// you zoomed.
const RANGES = [
  { label: '3m', days: 91 },
  { label: '6m', days: 182 },
  { label: '1y', days: 365 },
] as const

const H = 260
// Right gutter holds the axis ticks and the two projection end-labels.
const PAD = { top: 18, right: 54, bottom: 8, left: 8 }

interface Marker {
  x: number
  y: number
  label: string
  date: string
}

// Render at real pixel size rather than scaling a viewBox — a stretched viewBox
// distorts stroke widths and text on a chart this wide.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, Math.max(width, 280)] as const
}

export function CompoundCurve({ data }: { data: Momentum }) {
  const [rangeDays, setRangeDays] = useState<number>(182)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [wrapRef, W] = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)

  const PLOT_W = W - PAD.left - PAD.right
  const PLOT_H = H - PAD.top - PAD.bottom

  const model = useMemo(() => {
    const projWeeks = Math.round(rangeDays / 7)
    // Archived habits feed the history (their earned days are permanent) but not
    // the projection — activeDaysPerWeek below only looks at current habits.
    const series = progressSeries([...data.trajectory, ...(data.archived ?? [])])

    // Values are absolute multipliers, so slicing the tail is safe — the
    // earlier history is already folded into the running total.
    const from = Math.max(0, series.actual.length - rangeDays)
    const actual = series.actual.slice(from)
    const ceiling = series.ceiling.slice(from)

    const weeklyActive = activeDaysPerWeek(data.trajectory)
    const fan = projectFan(series.progressDays, data.consistency.rhythm, weeklyActive, projWeeks)

    // With no votes there's no pace to project, and "+1 day a week" would promise
    // a limp 1.7×. The honest, motivating line is the one the app is actually
    // asking for: hit every scheduled day.
    const starting = data.totalVotes === 0
    const promise = starting && weeklyActive > 0 ? project(0, weeklyActive, projWeeks) : null

    const histDays = actual.length
    const totalDays = Math.max(1, histDays - 1 + projWeeks * 7)

    const forward: ProjectedPoint[][] = starting
      ? (promise ? [promise] : [])
      : [fan.atOneMoreDay, fan.atCurrentPace]

    // Y-max rides the highest *shown* line, never a hypothetical perfect-forever
    // curve — that squashes the real one to the floor and reads as a rebuke.
    const forwardEnd = forward.length
      ? Math.max(...forward.map((f) => f[f.length - 1].value))
      : (actual[actual.length - 1]?.value ?? 1)
    const ceilingEnd = ceiling[ceiling.length - 1]?.value ?? 1
    const yMaxRaw = Math.max(ceilingEnd, forwardEnd) * 1.05

    const shown = [...actual.map((p) => p.value), ...ceiling.map((p) => p.value)]
    const yMin = shown.length ? Math.min(...shown) : 1
    // A dead-flat curve (no votes, nothing scheduled) would give a zero span.
    const yMax = yMaxRaw > yMin ? yMaxRaw : yMin + 1
    const ySpan = yMax - yMin

    const xOf = (dayIdx: number) => PAD.left + (dayIdx / totalDays) * PLOT_W
    const yOf = (v: number) => PAD.top + PLOT_H - ((v - yMin) / ySpan) * PLOT_H

    const path = (pts: Point[]) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(p.value).toFixed(2)}`).join(' ')

    const projPath = (pts: ProjectedPoint[]) =>
      pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(histDays - 1 + p.weekOffset * 7).toFixed(2)} ${yOf(p.value).toFixed(2)}`)
        .join(' ')

    // Phase graduations pin the metaphor to things that actually happened.
    const indexByDate = new Map(actual.map((p, i) => [p.date, i]))
    const markers: Marker[] = []
    for (const h of data.trajectory) {
      for (const p of h.phases) {
        if (!p.graduatedAt) continue
        const d = p.graduatedAt.slice(0, 10)
        const i = indexByDate.get(d)
        if (i === undefined) continue
        markers.push({
          x: xOf(i),
          y: yOf(actual[i].value),
          label: `${h.title} · Phase ${p.phaseNumber} graduated`,
          date: d,
        })
      }
    }

    const ticks: { y: number; label: string }[] = []
    for (let i = 0; i <= 3; i++) {
      const v = yMin + (ySpan * i) / 3
      ticks.push({ y: yOf(v), label: formatMultiplier(v) })
    }

    const lastDate = actual[actual.length - 1]?.date ?? new Date().toISOString().slice(0, 10)

    return {
      actual, ceiling, fan, promise, starting, histDays, totalDays, projWeeks,
      weeklyActive, progressDays: series.progressDays, activeDays: series.activeDays,
      xOf, yOf, path, projPath, markers, ticks,
      todayX: xOf(histDays - 1),
      endDate: addWeeks(parseISO(lastDate), projWeeks),
      current: actual[actual.length - 1]?.value ?? 1,
    }
  }, [data, rangeDays, PLOT_W, PLOT_H])

  const {
    actual, fan, promise, starting, histDays, totalDays, weeklyActive, projWeeks,
    xOf, yOf, path, projPath, markers, ticks, todayX, endDate, current, ceiling,
    progressDays, activeDays,
  } = model

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    setHoverX(x < PAD.left || x > PAD.left + PLOT_W ? null : x)
  }

  // Nothing scheduled anywhere (every habit paused, or a schedule-less habit) —
  // there's no day for the curve to stand on.
  const empty = actual.length === 0

  // Map the cursor back to a day, then to whichever series owns that day.
  const readout = useMemo(() => {
    if (hoverX === null) return null
    const dayIdx = Math.round(((hoverX - PAD.left) / PLOT_W) * totalDays)

    if (dayIdx <= histDays - 1) {
      const i = Math.max(0, Math.min(dayIdx, actual.length - 1))
      const p = actual[i]
      if (!p) return null
      return { x: xOf(i), y: yOf(p.value), title: format(parseISO(p.date), 'd MMM yyyy'), value: formatMultiplier(p.value), note: null as string | null }
    }

    const line = starting ? promise : fan.atCurrentPace
    if (!line) return null
    const week = Math.max(0, Math.min(Math.round((dayIdx - (histDays - 1)) / 7), projWeeks))
    const p = line[week]
    if (!p) return null
    return {
      x: xOf(histDays - 1 + week * 7),
      y: yOf(p.value),
      title: format(addWeeks(parseISO(actual[actual.length - 1].date), week), 'MMM yyyy'),
      value: formatMultiplier(p.value),
      note: starting ? 'if you hit every scheduled day' : 'at your current pace',
    }
  }, [hoverX, totalDays, histDays, actual, starting, promise, fan, xOf, yOf, PLOT_W, projWeeks])

  const paceEndY = yOf(fan.paceEnd)
  const oneMoreEndY = yOf(fan.oneMoreEnd)
  // Keep the two end-labels from colliding when the lines converge.
  const clash = Math.abs(paceEndY - oneMoreEndY) < 12

  // The number, made checkable: exponent, the days it's out of, the pace the
  // projection assumes, and the raw reps underneath — so nothing is a black box.
  const exponent = Math.round(progressDays)
  const possibleDays = Math.round(activeDays)
  const rhythm = data.consistency.rhythm
  const reps = data.totalVotes

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">
            Your compound curve
          </span>
          <p className="mt-1 font-display text-4xl font-semibold tracking-tight text-text-1">
            {formatMultiplier(current)}
          </p>
          {!empty && !starting && exponent > 0 && (
            <p className="mt-0.5 text-xs text-text-3">
              1.01 raised to {exponent} {exponent === 1 ? 'day' : 'days'} of showing up
            </p>
          )}
        </div>
        <div className="inline-flex shrink-0 gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                rangeDays === r.days ? 'bg-white text-text-1 shadow-sm' : 'text-text-3 hover:text-text-2'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        {empty ? (
          <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border">
            <p className="max-w-xs text-center text-sm text-text-2">
              Nothing scheduled right now — unpause a habit and the curve picks up where it left off.
            </p>
          </div>
        ) : (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          className="block touch-none select-none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverX(null)}
        >
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left} x2={PAD.left + PLOT_W} y1={t.y} y2={t.y}
                stroke="rgb(var(--color-border))" strokeWidth={1} strokeDasharray="2 4"
              />
              <text x={PAD.left + PLOT_W + 6} y={t.y + 3} fontSize={10} fill="rgb(var(--color-text-3))">
                {t.label}
              </text>
            </g>
          ))}

          {/* What was available: every scheduled day hit, rest days excluded. */}
          <path
            d={path(ceiling)} fill="none" strokeDasharray="3 4"
            stroke="rgb(var(--color-text-3) / 0.55)" strokeWidth={1.25}
          />

          <line
            x1={todayX} x2={todayX} y1={PAD.top} y2={PAD.top + PLOT_H}
            stroke="rgb(var(--color-text-3) / 0.5)" strokeWidth={1}
          />
          <text x={todayX + 4} y={PAD.top + 9} fontSize={9} fill="rgb(var(--color-text-3))">today</text>

          {starting ? (
            promise && (
              <path
                d={projPath(promise)} fill="none" strokeDasharray="5 4"
                stroke="rgb(var(--color-accent) / 0.5)" strokeWidth={1.5}
              />
            )
          ) : (
            <>
              <path
                d={projPath(fan.atOneMoreDay)} fill="none" strokeDasharray="5 4"
                stroke="rgb(var(--color-accent) / 0.4)" strokeWidth={1.5}
              />
              <path
                d={projPath(fan.atCurrentPace)} fill="none" strokeDasharray="5 4"
                stroke="rgb(var(--color-accent) / 0.8)" strokeWidth={1.75}
              />
            </>
          )}

          <motion.path
            key={`${rangeDays}-${W}`}
            d={path(actual)} fill="none"
            stroke="rgb(var(--color-accent))" strokeWidth={2.25}
            strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />

          {markers.map((m, i) => (
            <g key={i}>
              <circle cx={m.x} cy={m.y} r={4.5} fill="rgb(var(--color-surface))" />
              <circle cx={m.x} cy={m.y} r={3} fill="rgb(var(--color-success))">
                <title>{m.label} — {format(parseISO(m.date), 'd MMM yyyy')}</title>
              </circle>
            </g>
          ))}

          {!starting && (
            <>
              <text
                x={PAD.left + PLOT_W + 6} y={oneMoreEndY + (clash ? -4 : 3)}
                fontSize={10} fontWeight={600} fill="rgb(var(--color-text-2))"
              >
                {formatMultiplier(fan.oneMoreEnd)}
              </text>
              <text
                x={PAD.left + PLOT_W + 6} y={paceEndY + (clash ? 9 : 3)}
                fontSize={10} fill="rgb(var(--color-text-3))"
              >
                {formatMultiplier(fan.paceEnd)}
              </text>
            </>
          )}

          {readout && (
            <g className="pointer-events-none">
              <line
                x1={readout.x} x2={readout.x} y1={PAD.top} y2={PAD.top + PLOT_H}
                stroke="rgb(var(--color-text-1) / 0.25)" strokeWidth={1}
              />
              <circle cx={readout.x} cy={readout.y} r={3.5} fill="rgb(var(--color-accent))" />
            </g>
          )}
        </svg>
        )}

        {!empty && readout && (
          <div
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-text-1 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: readout.x, top: readout.y - 10, transform: 'translate(-50%, -100%)' }}
          >
            <span className="font-semibold">{readout.value}</span>
            <span className="ml-1.5 text-white/60">{readout.title}</span>
            {readout.note && <span className="ml-1.5 text-white/50">· {readout.note}</span>}
          </div>
        )}
      </div>

      {!empty && (
        <p className="mt-3 text-sm text-text-2">
          {starting ? (
            promise ? (
              <>
                Nothing cast yet. Hit every scheduled day and you’d be at{' '}
                <strong className="font-semibold text-text-1">
                  {formatMultiplier(promise[promise.length - 1].value)}
                </strong>{' '}
                by {format(endDate, 'MMMM yyyy')} — the first rep starts the climb.
              </>
            ) : (
              <>Schedule a habit and this curve starts climbing from the first rep.</>
            )
          ) : (
            <>
              You’re at <strong className="font-semibold text-text-1">{formatMultiplier(current)}</strong>. At your
              current pace you’ll be at{' '}
              <strong className="font-semibold text-text-1">{formatMultiplier(fan.paceEnd)}</strong> by{' '}
              {format(endDate, 'MMMM yyyy')}.
              {weeklyActive > 0 && fan.oneMoreEnd > fan.paceEnd && (
                <>
                  {' '}Show up one more day a week →{' '}
                  <strong className="font-semibold text-text-1">{formatMultiplier(fan.oneMoreEnd)}</strong>.
                </>
              )}
            </>
          )}
        </p>
      )}

      {!empty && !starting && weeklyActive > 0 && (
        <p className="mt-1 text-xs text-text-3">
          The dashed lines assume you keep hitting {rhythm}% of your days for a year — a projection, not a promise.
        </p>
      )}

      {!empty && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-text-3">
          <Key label="Days you showed up" color="rgb(var(--color-accent))" />
          {!starting && <Key dashed label="At your pace" color="rgb(var(--color-accent) / 0.8)" />}
          {!starting && fan.oneMoreEnd > fan.paceEnd && <Key dashed label="One more day a week" color="rgb(var(--color-accent) / 0.4)" />}
          {starting && promise && <Key dashed label="If you never miss" color="rgb(var(--color-accent) / 0.5)" />}
          {/* Before the first rep there's nothing behind you for this line to say. */}
          {!starting && <Key dashed label="Every scheduled day (so far)" color="rgb(var(--color-text-3) / 0.55)" />}
          {markers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" />
              Phase graduated
            </span>
          )}
        </div>
      )}

      {!empty && !starting && exponent > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-widest text-text-3 hover:text-text-2">
            <span className="group-open:hidden">How this is calculated</span>
            <span className="hidden group-open:inline">Hide the calculation</span>
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-text-2">
            <p>
              Every day you’re scheduled, the share of your habits you complete adds to a running
              day count — do everything and the day counts in full; do half and it counts half.
            </p>
            <p>
              You’ve banked the equivalent of{' '}
              <strong className="font-semibold text-text-1">{exponent} full {exponent === 1 ? 'day' : 'days'}</strong>{' '}
              out of the <strong className="font-semibold text-text-1">{possibleDays}</strong> you could have.
              Each one multiplies you by 1.01:
            </p>
            <p className="font-mono text-sm text-text-1">
              1.01<sup>{exponent}</sup> = {formatMultiplier(current)}
            </p>
            <p>
              Type <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">1.01 ^ {exponent}</code>{' '}
              into any calculator to check it. A perfect year — showing up every scheduled day — is 1.01<sup>365</sup> = 37.8×.
            </p>
            {weeklyActive > 0 && (
              <p>
                The forward lines project that count onward assuming you hold your current pace,
                hitting {rhythm}% of your days. That’s an estimate, not a promise — miss more and
                the real line stays lower.
              </p>
            )}
            <p className="text-text-3">
              Built from your {reps} logged {reps === 1 ? 'rep' : 'reps'}. Rest days and paused habits
              don’t count for or against you — the curve never drops on a miss, it just stops climbing.
            </p>
          </div>
        </details>
      )}

      <p className="mt-3 text-xs text-text-3">
        This pictures compounding — it doesn’t measure you.
      </p>
    </div>
  )
}

function Key({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width={16} height={2} className="shrink-0 overflow-visible">
        <line x1={0} y1={1} x2={16} y2={1} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '3 2.5' : undefined} />
      </svg>
      {label}
    </span>
  )
}
