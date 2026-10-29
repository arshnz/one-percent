import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle } from 'lucide-react'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { wearable as wearableApi } from '@/lib/api'
import { MetricPanel, type Slot } from '@/components/body/MetricPanel'
import { FindingsPanel } from '@/components/body/FindingsPanel'
import { cn } from '@/lib/utils'
import type { WearableDay } from '@/types'

// Your body's own record, standing on its own. Deliberately independent of
// habits: this page works, and is worth opening, with no habits at all.
//
// Everything here is measured rather than reported — the counterpart to the
// Momentum page, where every number ultimately comes from a button press.

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '6m', days: 182 },
  { label: '1y', days: 365 },
] as const

const DAY_MS = 86_400_000

const hhmm = (mins: number) => {
  const h = Math.floor(Math.round(mins) / 60)
  const m = Math.round(mins) % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}
const thousands = (v: number) => Math.round(v).toLocaleString()
const whole = (v: number) => String(Math.round(v))

export function BodyPage() {
  const [rangeDays, setRangeDays] = useState<number>(30)

  const { data, isLoading } = useQuery({
    queryKey: ['wearable-days', rangeDays],
    queryFn: () => wearableApi.days({ days: rangeDays }),
  })

  const { data: status } = useQuery({
    queryKey: ['wearable-status'],
    queryFn: () => wearableApi.status(),
  })

  // Expand the sparse response onto a dense date axis. The server returns only
  // the days it holds, so a day the watch never recorded is simply absent —
  // the charts need it present-but-null to draw the gap in the right place.
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

  const hasAnything = (status?.totalDays ?? 0) > 0

  return (
    <div className="animate-fade-in">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-text-3">
          <Activity size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">The Body</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          What your body recorded
        </h1>
        <p className="mt-1 text-sm text-text-2">
          Measured while you slept and moved — nothing here was remembered, rated or typed in.
          The charts are the evidence; the reading of them is above.
        </p>
      </header>

      {status?.status === 'error' && (
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-1">Garmin sync is failing</p>
            <p className="mt-0.5 break-words text-xs text-text-2">{status.error}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !hasAnything ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-card">
          <h2 className="font-serif text-lg font-medium text-text-1">Nothing synced yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-2">
            Once Garmin is connected, your sleep, resting heart rate, HRV and Body Battery land
            here automatically — there's nothing to log by hand.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <FindingsPanel />

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-text-3">
              {status?.lastSyncedAt
                ? `Last synced ${formatDistanceToNow(parseISO(status.lastSyncedAt), { addSuffix: true })}`
                : 'Not synced yet'}
              {status?.firstDate && ` · history from ${format(parseISO(status.firstDate), 'd MMM yyyy')}`}
            </p>
            <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
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

          <div className="pt-1">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">
              The raw record
            </h2>
            <p className="mt-1 text-xs text-text-3">
              Every day as it was measured. Nothing smoothed, nothing filled in.
            </p>
          </div>

          <MetricPanel
            title="Sleep"
            hint="Total time asleep, split into the stages Garmin scored."
            slots={slots}
            mode="stack"
            stackTotalKey="sleepMinutes"
            fields={[
              { key: 'deepMinutes', label: 'Deep', color: 'rgb(var(--color-violet))' },
              { key: 'remMinutes', label: 'REM', color: 'rgb(var(--color-amber))' },
            ]}
            formatValue={hhmm}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <MetricPanel
              title="Resting heart rate"
              hint="The thick band is your 14-day baseline — what matters is the gap between it and the line."
              slots={slots}
              mode="line"
              baselineDays={14}
              fields={[{ key: 'restingHr', label: 'Resting HR', color: 'rgb(var(--color-accent))' }]}
              unit="bpm"
              formatValue={whole}
            />

            <MetricPanel
              title="Overnight HRV"
              hint="Heart-rate variability while you slept. Higher usually means better recovered."
              slots={slots}
              mode="line"
              baselineDays={14}
              fields={[{ key: 'hrvNight', label: 'HRV', color: 'rgb(var(--color-success))' }]}
              unit="ms"
              formatValue={whole}
            />

            <MetricPanel
              title="Body Battery"
              hint="Each bar spans the day's low to its high — how much you had, and how much you spent."
              slots={slots}
              mode="range"
              domain={{ min: 0, max: 100 }}
              fields={[
                { key: 'bodyBatteryLow', label: 'Low', color: 'rgb(var(--color-amber))' },
                { key: 'bodyBatteryHigh', label: 'High', color: 'rgb(var(--color-amber))' },
              ]}
              formatValue={whole}
            />

            <MetricPanel
              title="Average stress"
              hint="Garmin's all-day stress score, averaged."
              slots={slots}
              mode="line"
              domain={{ min: 0, max: 100 }}
              fields={[{ key: 'stressAvg', label: 'Stress', color: 'rgb(var(--color-danger))' }]}
              formatValue={whole}
            />
          </div>

          <MetricPanel
            title="Steps"
            hint="Every day you carried the watch."
            slots={slots}
            mode="bars"
            domain={{ min: 0 }}
            fields={[{ key: 'steps', label: 'Steps', color: 'rgb(var(--color-accent))' }]}
            formatValue={thousands}
          />

          <p className="pb-2 text-center text-[11px] text-text-3">
            Days the watch wasn't worn are left blank rather than filled in.
          </p>
        </div>
      )}
    </div>
  )
}
