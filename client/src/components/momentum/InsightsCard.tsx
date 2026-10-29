import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { RefreshCw, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { ai as aiApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// Natural-language read of recent check-ins, miss reasons and — when a wearable
// is connected — the statistically tested findings about it.
//
// Served from the workstation's cache, which is refreshed after each check-in
// save. The button here is the only other way to regenerate: without it the
// insights could sit weeks out of date, silently ignoring everything that had
// happened since, and there would be no way to tell from looking at them.
export function InsightsCard({
  insights,
  wsId,
}: {
  insights: { items: string[]; generatedAt: string } | null
  wsId: string
}) {
  const qc = useQueryClient()

  const regenerate = useMutation({
    mutationFn: () => aiApi.generateInsights(wsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      toast.success('Insights refreshed')
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't refresh insights"),
  })

  if (!insights || insights.items.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-text-3">
          <Sparkles size={15} />
          <h2 className="text-xs font-semibold uppercase tracking-widest">What the data says</h2>
        </div>
        <button
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          title="Read my latest data again"
          className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
            'text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2',
            'disabled:opacity-60'
          )}
        >
          <RefreshCw size={11} className={regenerate.isPending ? 'animate-spin' : undefined} />
          {regenerate.isPending ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      <ul className="space-y-2.5">
        {insights.items.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-text-1">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            {line}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-text-3">
        Written {format(new Date(insights.generatedAt), 'd MMM')}
      </p>
    </section>
  )
}
