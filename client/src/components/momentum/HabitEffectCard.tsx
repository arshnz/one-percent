import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, TrendingDown, TrendingUp, Minus, Hourglass } from 'lucide-react'
import { effect as effectApi, wearable as wearableApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { EffectResult, WearableMetric } from '@/types'

// "Is this habit actually doing anything?"
//
// The whole value of this card is that it is willing to say no. Three of its
// four states are some flavour of "we can't tell yet" or "nothing here", and
// that is the point — a card that only ever congratulated the user would be
// worse than not having it.
//
// It renders `result.sentence` verbatim. The server does the hedging (it is an
// association, never a proven cause) and this component must not restate the
// raw difference in stronger words.

export function HabitEffectCard({ wsId, habitId }: { wsId: string; habitId: string }) {
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)

  // Nothing measured means nothing to measure against — stay out of the way
  // entirely rather than advertising a feature that can't run.
  const { data: wearableDays } = useQuery({
    queryKey: ['wearable-days', 90],
    queryFn: () => wearableApi.days({ days: 90 }),
  })
  const hasWearable = (wearableDays?.days.length ?? 0) > 0

  const { data } = useQuery({
    queryKey: ['habit-effect', wsId, habitId],
    queryFn: () => effectApi.get(wsId, habitId),
    enabled: hasWearable,
  })

  const { data: available } = useQuery({
    queryKey: ['habit-effect-available', wsId, habitId],
    queryFn: () => effectApi.available(wsId, habitId),
    enabled: hasWearable && picking,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['habit-effect', wsId, habitId] })
    qc.invalidateQueries({ queryKey: ['habit-effect-available', wsId, habitId] })
  }

  const link = useMutation({
    mutationFn: (metric: WearableMetric) => effectApi.link(wsId, habitId, metric, 1),
    onSuccess: () => { setPicking(false); invalidate() },
  })
  const unlink = useMutation({
    mutationFn: (metric: WearableMetric) => effectApi.unlink(wsId, habitId, metric),
    onSuccess: invalidate,
  })

  if (!hasWearable) return null

  const results = data?.results ?? []

  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-3">
          Is it moving anything?
        </p>
        {!picking && (
          <button
            onClick={() => setPicking(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2"
          >
            <Plus size={11} /> Track a metric
          </button>
        )}
      </div>

      {picking && (
        <div className="mt-2 rounded-xl border border-border bg-surface-2/40 p-2.5">
          <p className="mb-2 text-[11px] text-text-2">
            Compare the days you did this against the days you didn't.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(available?.metrics ?? []).filter((m) => !m.linked).map((m) => (
              <button
                key={m.key}
                disabled={link.isPending}
                onClick={() => link.mutate(m.key)}
                className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-text-2 transition-colors hover:border-text-3 hover:text-text-1 disabled:opacity-50"
              >
                {m.label}
              </button>
            ))}
            {available && available.metrics.every((m) => m.linked) && (
              <p className="text-[11px] text-text-3">Every metric is already tracked.</p>
            )}
          </div>
          <button
            onClick={() => setPicking(false)}
            className="mt-2 text-[10px] text-text-3 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {results.length === 0 && !picking && (
        <p className="mt-1.5 text-xs text-text-3">
          Nothing tracked yet. Pick a metric and this will tell you — honestly — whether the
          days you show up look any different.
        </p>
      )}

      <div className="mt-2 space-y-2">
        {results.map((r) => (
          <EffectRow key={r.metric} result={r} onRemove={() => unlink.mutate(r.metric)} />
        ))}
      </div>
    </div>
  )
}

function EffectRow({ result, onRemove }: { result: EffectResult; onRemove: () => void }) {
  const { verdict, improved } = result

  const tone =
    verdict === 'associated' && improved ? 'text-success'
      : verdict === 'associated' ? 'text-amber'
      : 'text-text-3'

  // The arrow says which way the number moved; the colour says whether that is
  // good. Conflating the two (a "good" arrow that always points up) would make
  // a falling resting heart rate and a rising HRV render identically.
  const Icon =
    verdict === 'insufficient' ? Hourglass
      : verdict === 'no_effect' ? Minus
      : result.difference < 0 ? TrendingDown
      : TrendingUp

  return (
    <div className="group rounded-xl border border-border bg-surface-2/30 p-2.5">
      <div className="flex items-start gap-2">
        <Icon size={13} className={cn('mt-0.5 shrink-0', tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="text-[11px] font-medium text-text-1">{result.label}</p>
            {verdict === 'associated' && (
              <span className={cn('text-[10px] font-medium', tone)}>
                {result.difference > 0 ? '+' : ''}{result.difference.toFixed(result.unit === 'min' ? 0 : 1)}
                {result.unit && ` ${result.unit}`}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-2">{result.sentence}</p>
          {verdict !== 'insufficient' && (
            <p className="mt-1 text-[10px] text-text-3">
              {result.hit.n} days you did it vs {result.miss.n} you didn't · p={result.pValue.toFixed(3)}
            </p>
          )}
        </div>
        <button
          onClick={onRemove}
          aria-label={`Stop tracking ${result.label}`}
          className="shrink-0 rounded p-0.5 text-text-3 opacity-0 transition-opacity hover:text-text-1 group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
