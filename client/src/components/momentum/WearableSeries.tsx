import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { wearable as wearableApi } from '@/lib/api'
import { MetricPanel, type Slot } from '@/components/body/MetricPanel'
import { cn } from '@/lib/utils'
import type { WearableDay } from '@/types'

// The third measured series. The other two on this page — the SRBAI score and
// the weekly 1-10 — are both things the user said about themselves. This one
// was recorded while they slept, which is the entire point of putting it here.
//
// Fetches its own data rather than riding on the momentum payload: the Momentum
// response already carries a year of per-habit grids, and this would have added
// another year times five metrics to it for a panel that renders independently.
// It also means the whole page degrades to exactly its old behaviour when
// nothing is connected — this component simply renders nothing.

const WINDOW_DAYS = 90
const DAY_MS = 86_400_000

const hhmm = (mins: number) => `${Math.floor(Math.round(mins) / 60)}h ${String(Math.round(mins) % 60).padStart(2, '0')}m`
const whole = (v: number) => String(Math.round(v))

const CHOICES = [
  {
    key: 'sleep' as const,
    label: 'Sleep',
    props: {
      mode: 'stack' as const,
      stackTotalKey: 'sleepMinutes' as const,
      fields: [
        { key: 'deepMinutes' as const, label: 'Deep', color: 'rgb(var(--color-violet))' },
        { key: 'remMinutes' as const, label: 'REM', color: 'rgb(var(--color-amber))' },
      ],
      formatValue: hhmm,
    },
  },
  {
    key: 'restingHr' as const,
    label: 'Resting HR',
    props: {
      mode: 'line' as const,
      baselineDays: 14,
      fields: [{ key: 'restingHr' as const, label: 'Resting HR', color: 'rgb(var(--color-accent))' }],
      unit: 'bpm',
      formatValue: whole,
    },
  },
  {
    key: 'hrvNight' as const,
    label: 'HRV',
    props: {
      mode: 'line' as const,
      baselineDays: 14,
      fields: [{ key: 'hrvNight' as const, label: 'HRV', color: 'rgb(var(--color-success))' }],
      unit: 'ms',
      formatValue: whole,
    },
  },
  {
    key: 'bodyBattery' as const,
    label: 'Body Battery',
    props: {
      mode: 'range' as const,
      domain: { min: 0, max: 100 },
      fields: [
        { key: 'bodyBatteryLow' as const, label: 'Low', color: 'rgb(var(--color-amber))' },
        { key: 'bodyBatteryHigh' as const, label: 'High', color: 'rgb(var(--color-amber))' },
      ],
      formatValue: whole,
    },
  },
]

/** Renders nothing at all when no wearable data exists. */
export function WearableSeries() {
  const [choice, setChoice] = useState(0)

  const { data } = useQuery({
    queryKey: ['wearable-days', WINDOW_DAYS],
    queryFn: () => wearableApi.days({ days: WINDOW_DAYS }),
  })

  const slots: Slot[] = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, WearableDay>(data.days.map((d) => [d.date, d]))
    const out: Slot[] = []
    const start = parseISO(data.from).getTime()
    const end = parseISO(data.to).getTime()
    for (let t = start; t <= end; t += DAY_MS) {
      const ds = format(new Date(t), 'yyyy-MM-dd')
      out.push({ date: ds, day: byDate.get(ds) ?? null })
    }
    return out
  }, [data])

  if (!data || data.days.length === 0) return null

  const active = CHOICES[choice]

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {CHOICES.map((c, i) => (
            <button
              key={c.key}
              onClick={() => setChoice(i)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                i === choice ? 'bg-white text-text-1 shadow-sm' : 'text-text-3 hover:text-text-2'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <MetricPanel
        title="What your watch recorded"
        hint={`The last ${WINDOW_DAYS} days, measured rather than reported — the only series here you didn't have to remember.`}
        slots={slots}
        {...active.props}
      />
    </div>
  )
}
