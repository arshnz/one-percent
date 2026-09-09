import { useState, KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Wand2, Sparkles } from 'lucide-react'
import { ai } from '@/lib/api'
import type { HabitBlueprint, HabitKind } from '@/types'

// One rough sentence → a full concrete blueprint that pre-fills the Architect.
// `initialText` lets the Compass hand over its rough habit sentence.
export function Atomizer({ kind = 'build', initialText, onApply }: { kind?: HabitKind; initialText?: string; onApply: (b: HabitBlueprint) => void }) {
  const [goal, setGoal] = useState(initialText ?? '')
  const breaking = kind === 'break'

  const run = useMutation({
    mutationFn: () => ai.atomize(goal.trim(), kind),
    onSuccess: ({ blueprint }) => onApply(blueprint),
  })

  const canRun = goal.trim().length >= 3 && !run.isPending

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
      e.preventDefault()
      run.mutate()
    }
  }

  return (
    <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-5 shadow-card">
      <div className="mb-2 flex items-center gap-2 text-accent">
        <Wand2 size={15} />
        <h2 className="text-xs font-semibold uppercase tracking-widest">Atomizer</h2>
      </div>
      <p className="mb-3 text-sm text-text-2">
        {breaking
          ? 'Describe the habit you want to quit in a sentence. I’ll draft the whole plan — the trigger to remove, a replacement, friction, accountability, and clean-day milestones — for you to review and tweak.'
          : 'Describe what you want in a sentence. I’ll draft the whole concrete blueprint — identity, cue, 2-minute fail-safe, celebration, and a phase ladder — for you to review and tweak.'}
      </p>
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={breaking
          ? 'e.g. I want to stop doomscrolling in bed at night'
          : 'e.g. I want to start running, but mornings are chaotic with the kids'}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      {run.isError && (
        <p className="mt-2 text-xs text-danger">
          {(run.error as Error)?.message ?? 'Could not draft a blueprint. Try again.'}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={!canRun}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {run.isPending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Drafting…
            </>
          ) : (
            <>
              <Sparkles size={15} /> Draft my blueprint
            </>
          )}
        </button>
        <span className="text-xs text-text-3">⌘↵ to run</span>
      </div>
    </section>
  )
}
