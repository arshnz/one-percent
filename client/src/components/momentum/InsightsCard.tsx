import { format } from 'date-fns'
import { Sparkles } from 'lucide-react'

// Natural-language read of recent check-ins + miss reasons. Served from the
// workstation's cache (regenerated after each check-in save) — this component
// never triggers an AI call.
export function InsightsCard({ insights }: { insights: { items: string[]; generatedAt: string } | null }) {
  if (!insights || insights.items.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-text-3">
        <Sparkles size={15} />
        <h2 className="text-xs font-semibold uppercase tracking-widest">What the data says</h2>
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
        From your check-ins · {format(new Date(insights.generatedAt), 'MMM d')}
      </p>
    </section>
  )
}
