import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useWidth } from '@/lib/useWidth'
import type { WearableDay } from '@/types'

// One day of the visible window. `day` is null when nothing was recorded — the
// watch was off, or the sync hasn't reached that far back. Gaps are drawn as
// gaps: an interpolated line through a day that was never measured would be the
// chart telling a story the data doesn't support.
export interface Slot {
  date: string
  day: WearableDay | null
}

type Field = keyof Omit<WearableDay, 'date'>

export interface MetricPanelProps {
  title: string
  hint?: string
  slots: Slot[]
  mode: 'line' | 'bars' | 'range' | 'stack'
  /** line/bars: one field. range: [low, high]. stack: the visible segments. */
  fields: { key: Field; label: string; color: string }[]
  /** stack only — the total; the remainder after `fields` is drawn muted. */
  stackTotalKey?: Field
  unit?: string
  /** Formats the headline and tooltip numbers. Defaults to a rounded integer. */
  formatValue?: (v: number) => string
  /**
   * Draw a trailing-mean baseline behind the line. For resting HR and HRV the
   * signal is deviation from your own baseline, not the absolute number.
   */
  baselineDays?: number
  /**
   * Hard bounds for the y-axis. Without this the headroom padding can push an
   * axis label past what the metric can even be — a 0-100 score labelled 112.
   */
  domain?: { min?: number; max?: number }
}

const H = 132
const PAD = { top: 12, right: 8, bottom: 16, left: 30 }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export function MetricPanel(props: MetricPanelProps) {
  const { title, hint, slots, mode, fields, stackTotalKey, unit, formatValue, baselineDays, domain } = props
  const [ref, width] = useWidth(260)

  const fmt = formatValue ?? ((v: number) => String(Math.round(v)))

  // The primary series drives the headline numbers and the y-scale.
  const primary = fields[0]?.key ?? (stackTotalKey as Field)

  // A range panel is summarised by its high — reporting Body Battery as the
  // day's LOW would be the most pessimistic reading of the number, and wrong.
  const statKey: Field = mode === 'range'
    ? (fields[1]?.key ?? fields[0].key)
    : (stackTotalKey ?? primary)

  const stats = useMemo(() => {
    const vals: number[] = []
    let latest: { v: number; date: string } | null = null
    let latestLow: number | null = null
    for (const s of slots) {
      const v = s.day ? num(s.day[statKey]) : null
      if (v === null) continue
      vals.push(v)
      latest = { v, date: s.date }
      latestLow = mode === 'range' && s.day ? num(s.day[fields[0].key]) : null
    }
    if (!vals.length) return null
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return { latest, latestLow, mean, n: vals.length }
  }, [slots, statKey, mode, fields])

  const plotW = Math.max(width - PAD.left - PAD.right, 10)
  const plotH = H - PAD.top - PAD.bottom

  // x by position in the window, so a missing day leaves a real hole in the
  // time axis rather than silently closing up.
  const xOf = (i: number) =>
    PAD.left + (slots.length <= 1 ? plotW / 2 : (i / (slots.length - 1)) * plotW)

  const { lo, hi } = useMemo(() => {
    const vals: number[] = []
    for (const s of slots) {
      if (!s.day) continue
      if (mode === 'stack' && stackTotalKey) {
        const t = num(s.day[stackTotalKey])
        if (t !== null) vals.push(t)
        continue
      }
      for (const f of fields) {
        const v = num(s.day[f.key])
        if (v !== null) vals.push(v)
      }
    }
    if (!vals.length) return { lo: 0, hi: 1 }
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    // Bars and stacks read from zero; a line would waste the whole panel there,
    // so it gets a padded window around its own range instead.
    if (mode !== 'line') min = 0
    if (min === max) { min -= 1; max += 1 }
    const pad = (max - min) * 0.12
    let outLo = mode === 'line' ? min - pad : 0
    let outHi = max + pad
    if (domain?.min !== undefined) outLo = Math.max(outLo, domain.min)
    if (domain?.max !== undefined) outHi = Math.min(outHi, domain.max)
    return { lo: outLo, hi: outHi }
  }, [slots, fields, mode, stackTotalKey, domain])

  const yOf = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH

  // Trailing mean over the preceding `baselineDays`, recomputed per slot so it
  // tracks a genuine drift rather than a single flat average of the window.
  const baseline = useMemo(() => {
    if (!baselineDays || mode !== 'line') return null
    const out: (number | null)[] = []
    for (let i = 0; i < slots.length; i++) {
      const window: number[] = []
      for (let j = Math.max(0, i - baselineDays + 1); j <= i; j++) {
        const v = slots[j].day ? num(slots[j].day![primary]) : null
        if (v !== null) window.push(v)
      }
      // Needs enough of the window filled to mean anything.
      out.push(window.length >= Math.min(5, baselineDays) ? window.reduce((a, b) => a + b, 0) / window.length : null)
    }
    return out
  }, [slots, baselineDays, primary, mode])

  const barW = Math.max(1.5, Math.min(14, plotW / Math.max(slots.length, 1) - 1.5))
  const showDots = slots.length <= 45

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-3">{title}</p>
          {hint && <p className="mt-0.5 text-xs text-text-3">{hint}</p>}
        </div>
        {stats && (
          <div className="shrink-0 text-right">
            <p className="font-display text-lg font-semibold leading-none text-text-1">
              {mode === 'range' && stats.latestLow !== null
                ? `${fmt(stats.latestLow)}–${fmt(stats.latest!.v)}`
                : fmt(stats.latest!.v)}
              {unit && <span className="ml-0.5 text-xs font-normal text-text-3">{unit}</span>}
            </p>
            <p className="mt-1 text-[10px] text-text-3">avg {fmt(stats.mean)}</p>
          </div>
        )}
      </div>

      <div ref={ref} className="mt-3">
        {!stats ? (
          <div className="flex h-[132px] items-center justify-center rounded-xl border border-dashed border-border/70">
            <p className="text-xs text-text-3">Nothing recorded in this range.</p>
          </div>
        ) : (
          <svg width={width} height={H} className="block">
            {/* Two reference lines only — the panel is small and a full grid
                would out-shout the data. */}
            {[lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75].map((v, i) => (
              <line
                key={i}
                x1={PAD.left} x2={width - PAD.right} y1={yOf(v)} y2={yOf(v)}
                stroke="rgb(var(--color-border))" strokeWidth={1} strokeDasharray="2 5"
              />
            ))}
            <text x={0} y={yOf(hi) + 8} fontSize={9} fill="rgb(var(--color-text-3))">{fmt(hi)}</text>
            <text x={0} y={yOf(lo)} fontSize={9} fill="rgb(var(--color-text-3))">{fmt(lo)}</text>

            {mode === 'line' && (
              <LineSeries
                slots={slots} field={primary} color={fields[0].color}
                xOf={xOf} yOf={yOf} showDots={showDots} fmt={fmt} baseline={baseline}
              />
            )}

            {mode === 'bars' && slots.map((s, i) => {
              const v = s.day ? num(s.day[fields[0].key]) : null
              if (v === null) return null
              const y = yOf(v)
              return (
                <rect
                  key={s.date} x={xOf(i) - barW / 2} y={y}
                  width={barW} height={Math.max(PAD.top + plotH - y, 0.5)}
                  rx={1.5} fill={fields[0].color} opacity={0.75}
                >
                  <title>{`${fmt(v)}${unit ? ` ${unit}` : ''} · ${format(parseISO(s.date), 'EEE d MMM')}`}</title>
                </rect>
              )
            })}

            {mode === 'range' && slots.map((s, i) => {
              const a = s.day ? num(s.day[fields[0].key]) : null
              const b = s.day ? num(s.day[fields[1]?.key]) : null
              if (a === null || b === null) return null
              const top = yOf(Math.max(a, b))
              const bottom = yOf(Math.min(a, b))
              return (
                <rect
                  key={s.date} x={xOf(i) - barW / 2} y={top}
                  width={barW} height={Math.max(bottom - top, 1.5)}
                  rx={barW / 2} fill={fields[1]?.color ?? fields[0].color} opacity={0.7}
                >
                  <title>{`${fmt(Math.min(a, b))}–${fmt(Math.max(a, b))} · ${format(parseISO(s.date), 'EEE d MMM')}`}</title>
                </rect>
              )
            })}

            {mode === 'stack' && slots.map((s, i) => {
              if (!s.day) return null
              const total = stackTotalKey ? num(s.day[stackTotalKey]) : null
              if (total === null) return null
              const segs = fields.map((f) => ({ ...f, v: num(s.day![f.key]) ?? 0 }))
              const known = segs.reduce((a, x) => a + x.v, 0)
              // Whatever the named stages don't account for — light sleep and
              // wake. Drawn muted rather than dropped, so the bar's height is
              // always the real total.
              const rest = Math.max(total - known, 0)
              let cursor = 0
              const parts = [...segs, { key: 'rest' as const, label: 'Light / awake', color: 'rgb(var(--color-surface-2))', v: rest }]
              return (
                <g key={s.date}>
                  {parts.map((p) => {
                    const y0 = yOf(cursor)
                    cursor += p.v
                    const y1 = yOf(cursor)
                    if (p.v <= 0) return null
                    return (
                      <rect
                        key={p.key} x={xOf(i) - barW / 2} y={y1}
                        width={barW} height={Math.max(y0 - y1, 0.5)}
                        fill={p.color} opacity={0.85}
                      >
                        <title>{`${p.label}: ${fmt(p.v)} · ${format(parseISO(s.date), 'EEE d MMM')}`}</title>
                      </rect>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        )}
      </div>

      {(mode === 'stack' || fields.length > 1) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3">
          {fields.map((f) => (
            <span key={f.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />
              {f.label}
            </span>
          ))}
          {mode === 'stack' && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-surface-2" />
              Light / awake
            </span>
          )}
        </div>
      )}

      {stats && stats.n < slots.length && (
        <p className="mt-2 text-[10px] text-text-3">
          {slots.length - stats.n} of {slots.length} days not recorded — shown as gaps, never filled in.
        </p>
      )}
    </section>
  )
}

/**
 * A line broken wherever the data is. Consecutive readings join up; a missing
 * day ends the current subpath and the next reading starts a new one.
 */
function LineSeries({
  slots, field, color, xOf, yOf, showDots, fmt, baseline,
}: {
  slots: Slot[]
  field: Field
  color: string
  xOf: (i: number) => number
  yOf: (v: number) => number
  showDots: boolean
  fmt: (v: number) => string
  baseline: (number | null)[] | null
}) {
  const runs: { i: number; v: number }[][] = []
  let run: { i: number; v: number }[] = []
  slots.forEach((s, i) => {
    const v = s.day ? num(s.day[field]) : null
    if (v === null) {
      if (run.length) runs.push(run)
      run = []
    } else {
      run.push({ i, v })
    }
  })
  if (run.length) runs.push(run)

  const pathOf = (pts: { i: number; v: number }[]) =>
    pts.map((p, k) => `${k === 0 ? 'M' : 'L'} ${xOf(p.i).toFixed(1)} ${yOf(p.v).toFixed(1)}`).join(' ')

  const baseRuns: { i: number; v: number }[][] = []
  if (baseline) {
    let br: { i: number; v: number }[] = []
    baseline.forEach((v, i) => {
      if (v === null) { if (br.length) baseRuns.push(br); br = [] }
      else br.push({ i, v })
    })
    if (br.length) baseRuns.push(br)
  }

  return (
    <g>
      {baseRuns.map((pts, k) => (
        <path
          key={`b${k}`} d={pathOf(pts)} fill="none"
          stroke={color} strokeWidth={4} opacity={0.16} strokeLinecap="round"
        />
      ))}
      {runs.map((pts, k) =>
        pts.length === 1 ? (
          <circle key={k} cx={xOf(pts[0].i)} cy={yOf(pts[0].v)} r={1.8} fill={color} />
        ) : (
          <path
            key={k} d={pathOf(pts)} fill="none" stroke={color}
            strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
          />
        )
      )}
      {showDots && runs.flat().map((p) => (
        <circle key={p.i} cx={xOf(p.i)} cy={yOf(p.v)} r={2.2} fill={color}>
          <title>{`${fmt(p.v)} · ${format(parseISO(slots[p.i].date), 'EEE d MMM')}`}</title>
        </circle>
      ))}
    </g>
  )
}
