import { useMemo } from 'react'
import { progressSeries, formatMultiplier } from '@/lib/compound'
import type { Momentum } from '@/types'

const W = 100
const H = 22

/**
 * One habit's own compound curve, small enough to sit in a card. No axes, no
 * projection — the shape and the number are the point: which habits are actually
 * carrying you.
 *
 * Runs through the same progressSeries as the headline curve, so a habit's
 * sparkline and the aggregate can never disagree about the maths.
 *
 * Drawn in a fixed viewBox and stretched, so `vectorEffect="non-scaling-stroke"`
 * keeps the line an even weight at any width.
 */
export function HabitSparkline({ habit, color }: { habit: Momentum['trajectory'][number]; color: string }) {
  const model = useMemo(() => {
    const { actual } = progressSeries([habit])
    if (actual.length < 2) return null

    const values = actual.map((p) => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1

    const d = actual
      .map((p, i) => {
        const x = (i / (actual.length - 1)) * W
        const y = H - ((p.value - min) / span) * (H - 2) - 1
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')

    return { d, current: values[values.length - 1] }
  }, [habit])

  if (!model) return null

  return (
    <div className="flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[22px] flex-1" aria-hidden>
        <path
          d={model.d} fill="none" stroke={color} strokeWidth={1.75}
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-text-1">
        {formatMultiplier(model.current)}
      </span>
    </div>
  )
}
