import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Fingerprint, Hammer, CornerUpRight, Map, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { ai, goals as goalsApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { Modal } from '@/components/ui/Modal'

interface Props {
  open: boolean
  notes: string[]
  onClose: () => void
  onAddNote: (content: string) => void
  onSendToArchitect: (prefill: { title?: string; whyText?: string }) => void
}

export function SynthesisPanel({ open, notes, onClose, onAddNote, onSendToArchitect }: Props) {
  const wsId = useAuthStore((s) => s.activeWorkstationId)!
  const qc = useQueryClient()
  const [savedGoalIdx, setSavedGoalIdx] = useState<Set<number>>(new Set())
  const run = useMutation({ mutationFn: () => ai.synthesize(notes) })

  const saveGoal = useMutation({
    mutationFn: async ({ g, i }: { g: { title: string; domain: any; why: string }; i: number }) => {
      await goalsApi.create(wsId, {
        title: g.title,
        domain: g.domain,
        whyText: g.why,
        sourceNote: 'canvas-synthesis',
      })
      return i
    },
    onSuccess: (i) => {
      setSavedGoalIdx((prev) => new Set(prev).add(i))
      qc.invalidateQueries({ queryKey: ['goals', wsId] })
      toast.success('Saved as a goal — link habits to it from the Architect.')
    },
    onError: () => toast.error('Could not save that goal.'),
  })

  // Kick off synthesis each time the panel opens with notes.
  useEffect(() => {
    if (open && notes.length > 0) run.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const data = run.data?.synthesis

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Synthesise your vision"
      description="What your canvas says about who you’re becoming."
      size="lg"
    >
      <div className="max-h-[64vh] overflow-y-auto pr-1">
        {run.isPending && (
          <div className="flex flex-col items-center gap-3 py-12 text-text-2">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-sm">Reading your canvas…</p>
          </div>
        )}

        {run.isError && (
          <p className="py-8 text-center text-sm text-danger">
            {(run.error as Error)?.message ?? 'Could not synthesise. Try again.'}
          </p>
        )}

        {data && (
          <div className="space-y-6">
            {/* Themes */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-text-2">
                <Layers size={13} /> Recurring themes
              </h3>
              <div className="space-y-2">
                {data.themes.map((t, i) => (
                  <div key={i} className="rounded-xl border border-border bg-bg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-1">{t.title}</p>
                        <p className="mt-0.5 text-sm text-text-2">{t.summary}</p>
                      </div>
                      <button
                        onClick={() => onAddNote(`${t.title} — ${t.summary}`)}
                        className="shrink-0 text-text-3 transition-colors hover:text-accent"
                        title="Add to canvas"
                      >
                        <CornerUpRight size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Identity statements */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-text-2">
                <Fingerprint size={13} /> Who you’re becoming
              </h3>
              <div className="space-y-2">
                {data.identityStatements.map((s, i) => (
                  <div key={i} className="rounded-xl border border-border bg-bg p-3">
                    <p className="font-serif text-sm italic text-text-1">“{s}”</p>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => onSendToArchitect({ title: s })}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:opacity-80"
                      >
                        <Hammer size={13} /> Build a habit for this
                      </button>
                      <button
                        onClick={() => onAddNote(s)}
                        className="inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-2"
                      >
                        <CornerUpRight size={12} /> Add to canvas
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Goals hiding in the canvas — the board feeds destinations (Z),
                and habits get engineered toward them from the Architect. */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-text-2">
                <Map size={13} /> Goals hiding in your canvas
              </h3>
              <div className="space-y-2">
                {data.suggestedGoals.map((g, i) => (
                  <div key={i} className="rounded-xl border border-border bg-bg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-1">{g.title}</p>
                        <p className="mt-0.5 text-sm text-text-2">{g.why}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-text-3">{g.domain}</p>
                      </div>
                      <button
                        onClick={() => saveGoal.mutate({ g, i })}
                        disabled={savedGoalIdx.has(i) || saveGoal.isPending}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {savedGoalIdx.has(i) ? <><Check size={12} /> Saved</> : <><Map size={12} /> Save as goal</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>
  )
}
