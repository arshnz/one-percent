import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Dumbbell, Moon, TrendingUp, FlaskConical } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { wearable as wearableApi } from '@/lib/api'
import type { BodyFinding } from '@/types'

// The reason this page exists rather than opening the Garmin app.
//
// Garmin shows you your numbers. This shows you the things it has the data for
// and never says: when you actually fall asleep and how much that wanders,
// what a given kind of session costs you, which day of the week is reliably
// different, and whether a baseline quietly moved.
//
// Every claim here has been through a permutation test and a false-discovery
// correction (see server/src/lib/bodyInsights.ts). The panel is equally
// willing to say nothing — an empty findings list is a real answer, not a
// failure, and saying so is what makes the non-empty ones worth believing.

const ICONS: Record<BodyFinding['kind'], LucideIcon> = {
  sleep_regularity: Moon,
  activity_impact: Dumbbell,
  weekday: CalendarDays,
  baseline_shift: TrendingUp,
}

const GROUPS: { kind: BodyFinding['kind']; title: string }[] = [
  { kind: 'sleep_regularity', title: 'When you sleep' },
  { kind: 'activity_impact', title: 'What your sessions cost' },
  { kind: 'baseline_shift', title: 'Things that shifted' },
  { kind: 'weekday', title: 'Your week has a shape' },
]

export function FindingsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['wearable-insights'],
    queryFn: () => wearableApi.insights(),
  })

  // Never returns null while loading. The analysis runs several thousand
  // permutations and takes a few seconds; rendering nothing in the meantime
  // made the whole panel look like it did not exist.
  if (isLoading || !data) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2 text-text-3">
          <FlaskConical size={15} />
          <h2 className="text-xs font-semibold uppercase tracking-widest">
            What Garmin doesn’t tell you
          </h2>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-xs text-text-3">
            Testing your history for patterns that hold up…
          </p>
        </div>
      </section>
    )
  }

  const found = data.findings.length > 0

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-text-3">
            <FlaskConical size={15} />
            <h2 className="text-xs font-semibold uppercase tracking-widest">
              What Garmin doesn’t tell you
            </h2>
          </div>
          <p className="mt-1 text-xs text-text-3">
            Read from {data.days} days of your own recordings. Only patterns that survived a
            statistical test appear here.
          </p>
        </div>
      </div>

      {!found ? (
        <div className="mt-4 rounded-xl border border-dashed border-border/70 p-6 text-center">
          <p className="text-sm text-text-2">Nothing stands out yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-text-3">
            That is a real answer rather than a gap — differences this small are what ordinary
            variation looks like. More history makes fainter patterns findable.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {GROUPS.map(({ kind, title }) => {
            const items = data.findings.filter((f) => f.kind === kind)
            if (!items.length) return null
            const Icon = ICONS[kind]
            return (
              <div key={kind}>
                <div className="mb-2 flex items-center gap-1.5 text-text-3">
                  <Icon size={12} />
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest">{title}</h3>
                </div>
                <ul className="space-y-2.5">
                  {items.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border bg-surface-2/30 p-3">
                      <p className="text-sm font-medium leading-snug text-text-1">{f.headline}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-2">{f.detail}</p>
                      {f.pValue !== undefined && (
                        <p className="mt-1.5 text-[10px] text-text-3">
                          p = {f.pValue < 0.001 ? '<0.001' : f.pValue.toFixed(3)} · corrected for
                          testing many patterns at once
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 border-t border-border/70 pt-3 text-[11px] leading-relaxed text-text-3">
        These are associations in your own data, not causes. A weekly rhythm usually reflects
        your calendar rather than your body.
      </p>
    </section>
  )
}
