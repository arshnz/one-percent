import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarCheck } from 'lucide-react'
import { checkins as checkinsApi } from '@/lib/api'

// The look-back shelf: every past weekly check-in (completed or skipped) so
// Momentum holds the whole reflective record, not just the rating series.
export function CheckInHistory({ wsId }: { wsId: string }) {
  const { data } = useQuery({
    queryKey: ['checkins', wsId],
    queryFn: () => checkinsApi.list(wsId),
    enabled: !!wsId,
  })

  if (!data || data.checkIns.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-text-3">
        <CalendarCheck size={15} />
        <h2 className="text-xs font-semibold uppercase tracking-widest">Check-in history</h2>
      </div>
      <div className="space-y-2">
        {data.checkIns.map((c) => (
          <div key={c.id} className="rounded-xl border border-border bg-bg p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-text-1">
                Week of {format(new Date(c.weekOf + 'T12:00:00'), 'MMM d')}
              </p>
              {c.status === 'skipped'
                ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-3">Skipped</span>
                : c.rating != null && <span className="shrink-0 text-xs text-text-3">{c.rating}/10</span>}
            </div>
            {c.aiSummary && <p className="mt-1 text-sm text-text-2">{c.aiSummary}</p>}
            {c.tinyVictory && <p className="mt-1 text-xs text-text-3">Win: {c.tinyVictory}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
