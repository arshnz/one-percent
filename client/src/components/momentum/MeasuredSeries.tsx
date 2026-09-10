import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, addWeeks } from 'date-fns'
import { getHabitColor } from '@/lib/utils'
import { wearable as wearableApi } from '@/lib/api'
import { WearableSeries } from './WearableSeries'
import type { Momentum } from '@/types'

// Mirrors PASS_THRESHOLD in server/src/routes/automaticity.ts — a mean of 4 on
// the 4-item SRBAI is what graduates a phase.
const PASS_THRESHOLD = 4.0

/**
 * The series the app actually *measures*, as opposed to the compound curve,
 * which pictures the vote count. All are sparse by nature and rendered that
 * way: an automaticity check only fires when a phase hits 'ready', a rating
 * only exists for weeks the user filled in a check-in, and the watch is not
 * always on the wrist.
 *
 * The first two are self-reported. The third — the wearable panel — is the only
 * thing on this page recorded by something other than the user's own judgement,
 * which is exactly why it belongs beside them rather than off on its own.
 */
export function MeasuredSeries({ data }: { data: Momentum }) {
  const automaticity = useAutomaticityLines(data)
  const ratings = data.weeklyRatings?.filter((r) => r.rating !== null) ?? []

  // Same query key as WearableSeries, so React Query serves both from one
  // request; this call only decides whether the section has anything to show.
  const { data: wearableDays } = useQuery({
    queryKey: ['wearable-days', 90],
    queryFn: () => wearableApi.days({ days: 90 }),
  })

  const showAuto = automaticity.length > 0
  const showRatings = ratings.length >= 3
  const showWearable = (wearableDays?.days.length ?? 0) > 0
  if (!showAuto && !showRatings && !showWearable) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">
          What you’ve measured
        </h2>
        <p className="mt-1 text-xs text-text-3">
          Not the curve above — these are the raw numbers, drawn straight, nothing modelled.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {showAuto && <AutomaticityChart lines={automaticity} />}
        {showRatings && <WeeklyRatings ratings={ratings as { weekOf: string; rating: number }[]} />}
      </div>
      {showWearable && <WearableSeries />}
    </div>
  )
}

interface AutoLine {
  habitId: string
  title: string
  points: { mean: number; passed: boolean; at: string }[]
}

/** One line per habit, but only habits with enough checks to show a direction. */
function useAutomaticityLines(data: Momentum): AutoLine[] {
  return useMemo(() => {
    const byHabit = new Map<string, AutoLine>()
    for (const c of data.automaticity ?? []) {
      const habit = data.trajectory.find((h) => h.habitId === c.habitId)
      if (!habit) continue
      let line = byHabit.get(c.habitId)
      if (!line) {
        line = { habitId: c.habitId, title: habit.title, points: [] }
        byHabit.set(c.habitId, line)
      }
      line.points.push({ mean: c.mean, passed: c.passed, at: c.createdAt })
    }
    return [...byHabit.values()].filter((l) => l.points.length >= 2)
  }, [data.automaticity, data.trajectory])
}

const AUTO_W = 320
const AUTO_H = 120
const AUTO_PAD = { top: 10, right: 10, bottom: 18, left: 22 }

function AutomaticityChart({ lines }: { lines: AutoLine[] }) {
  const plotW = AUTO_W - AUTO_PAD.left - AUTO_PAD.right
  const plotH = AUTO_H - AUTO_PAD.top - AUTO_PAD.bottom

  // A shared time axis across habits, so the lines are comparable.
  const times = lines.flatMap((l) => l.points.map((p) => new Date(p.at).getTime()))
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tSpan = tMax - tMin || 1

  const xOf = (t: number) => AUTO_PAD.left + ((t - tMin) / tSpan) * plotW
  // SRBAI items are 1–5.
  const yOf = (v: number) => AUTO_PAD.top + plotH - ((v - 1) / 4) * plotH

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-3">
        How automatic it feels
      </p>
      <p className="mt-0.5 text-xs text-text-3">
        Your SRBAI score each time a phase came up for a check. {PASS_THRESHOLD.toFixed(1)} graduates it.
      </p>

      <svg viewBox={`0 0 ${AUTO_W} ${AUTO_H}`} className="mt-2 h-[120px] w-full" preserveAspectRatio="xMidYMid meet">
        {[1, 3, 5].map((v) => (
          <g key={v}>
            <line
              x1={AUTO_PAD.left} x2={AUTO_W - AUTO_PAD.right} y1={yOf(v)} y2={yOf(v)}
              stroke="rgb(var(--color-border))" strokeWidth={1} strokeDasharray="2 4"
            />
            <text x={0} y={yOf(v) + 3} fontSize={9} fill="rgb(var(--color-text-3))">{v}</text>
          </g>
        ))}

        <line
          x1={AUTO_PAD.left} x2={AUTO_W - AUTO_PAD.right} y1={yOf(PASS_THRESHOLD)} y2={yOf(PASS_THRESHOLD)}
          stroke="rgb(var(--color-success) / 0.7)" strokeWidth={1} strokeDasharray="4 3"
        />
        <text x={AUTO_W - AUTO_PAD.right} y={yOf(PASS_THRESHOLD) - 3} fontSize={8} textAnchor="end" fill="rgb(var(--color-success))">
          pass
        </text>

        {lines.map((l) => {
          const color = getHabitColor(l.habitId).border
          const d = l.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(new Date(p.at).getTime()).toFixed(1)} ${yOf(p.mean).toFixed(1)}`)
            .join(' ')
          return (
            <g key={l.habitId}>
              <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
              {l.points.map((p, i) => (
                <circle
                  key={i} cx={xOf(new Date(p.at).getTime())} cy={yOf(p.mean)} r={3}
                  fill={p.passed ? color : 'rgb(var(--color-surface))'} stroke={color} strokeWidth={1.5}
                >
                  <title>
                    {l.title} — {p.mean.toFixed(2)} on {format(parseISO(p.at), 'd MMM yyyy')}
                    {p.passed ? ' (passed)' : ''}
                  </title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3">
        {lines.map((l) => (
          <span key={l.habitId} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: getHabitColor(l.habitId).border }} />
            <span className="max-w-[12rem] truncate">{l.title}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function WeeklyRatings({ ratings }: { ratings: { weekOf: string; rating: number }[] }) {
  const avg = ratings.reduce((a, r) => a + r.rating, 0) / ratings.length

  // Only weeks with a check-in come back from the server, so walk the whole week
  // axis and leave a gap where one is missing. A skipped week is not a zero.
  const slots = useMemo(() => {
    const byWeek = new Map(ratings.map((r) => [r.weekOf, r.rating]))
    const out: { weekOf: string; rating: number | null }[] = []
    let cursor = parseISO(ratings[0].weekOf)
    const last = parseISO(ratings[ratings.length - 1].weekOf)
    while (cursor <= last) {
      const key = format(cursor, 'yyyy-MM-dd')
      out.push({ weekOf: key, rating: byWeek.get(key) ?? null })
      cursor = addWeeks(cursor, 1)
    }
    return out
  }, [ratings])

  const skipped = slots.length - ratings.length

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-3">
        How the week felt
      </p>
      <p className="mt-0.5 text-xs text-text-3">
        Your own 1–10 rating at each weekly check-in. Averaging {avg.toFixed(1)}
        {skipped > 0 && ` across ${ratings.length} of ${slots.length} weeks`}.
      </p>

      <div className="mt-3 flex h-[120px] items-end gap-1">
        {slots.map((s) => (
          <div key={s.weekOf} className="group relative flex h-full flex-1 items-end">
            {s.rating === null ? (
              <div className="h-full w-full rounded-sm border border-dashed border-border/70" />
            ) : (
              <div
                className="w-full rounded-t-sm bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${(s.rating / 10) * 100}%` }}
              />
            )}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 scale-95 whitespace-nowrap rounded-lg bg-text-1 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
              {s.rating === null ? 'No check-in' : `${s.rating}/10`} · week of {format(parseISO(s.weekOf), 'd MMM')}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-text-3">
        <span>{format(parseISO(slots[0].weekOf), 'MMM yyyy')}</span>
        <span>{format(parseISO(slots[slots.length - 1].weekOf), 'MMM yyyy')}</span>
      </div>
    </section>
  )
}
