import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { ArrowLeft, CalendarCheck, Plus, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { checkins as checkinsApi, ai } from '@/lib/api'
import type { SetbackPlan } from '@/types'
import { GuidedChat, type ChatMessage } from '@/components/ai/GuidedChat'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

export function CheckInPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)!
  const qc = useQueryClient()

  const { data: current, isLoading } = useQuery({
    queryKey: ['checkin-current', wsId],
    queryFn: () => checkinsApi.current(wsId),
    enabled: !!wsId,
  })
  const { data: history } = useQuery({
    queryKey: ['checkins', wsId],
    queryFn: () => checkinsApi.list(wsId),
    enabled: !!wsId,
  })

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [rating, setRating] = useState<number | null>(null)
  const [tinyVictory, setTinyVictory] = useState('')
  const [workingWell, setWorkingWell] = useState('')
  const [notWorking, setNotWorking] = useState('')
  const [obstacles, setObstacles] = useState<SetbackPlan[]>([])
  const [freeform, setFreeform] = useState('')

  // Seed the companion's opener and prefill from an existing check-in once the
  // data pack lands.
  useEffect(() => {
    if (!current) return
    const wins = current.summary.filter((s) => s.scheduled > 0)
    const openerBits =
      wins.length > 0
        ? `You showed up ${wins.reduce((a, s) => a + s.hits, 0)} times across ${wins.length} ${wins.length === 1 ? 'habit' : 'habits'} this week. Let's look back together — no scores, just an honest look.`
        : `Let's look back on your week together — an honest, no-guilt review.`
    setMessages([{ role: 'model', text: `${openerBits} First: overall, how did the week feel, roughly 1 to 10?` }])
    if (current.existing) {
      setRating(current.existing.rating)
      setTinyVictory(current.existing.tinyVictory ?? '')
      setWorkingWell(current.existing.workingWell ?? '')
      setNotWorking(current.existing.notWorking ?? '')
      setFreeform(current.existing.freeform ?? '')
      try { setObstacles(JSON.parse(current.existing.obstacles)) } catch { setObstacles([]) }
    }
  }, [current])

  const save = useMutation({
    mutationFn: async () => {
      // Distil the conversation to two sentences the coaches will remember.
      let aiSummary: string | null = null
      if (messages.filter((m) => m.role === 'user').length > 0) {
        try { aiSummary = (await ai.checkinSummary(messages)).summary } catch { aiSummary = null }
      }
      return checkinsApi.save(wsId, {
        weekOf: current!.weekOf,
        rating,
        tinyVictory: tinyVictory.trim() || null,
        workingWell: workingWell.trim() || null,
        notWorking: notWorking.trim() || null,
        obstacles: obstacles.map((o) => ({ obstacle: o.obstacle.trim(), plan: o.plan.trim() })).filter((o) => o.obstacle && o.plan),
        freeform: freeform.trim() || null,
        aiSummary,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checkins', wsId] })
      qc.invalidateQueries({ queryKey: ['checkin-current', wsId] })
      toast.success('Check-in saved. See you next week.')
      // Refresh the cached Momentum insights in the background — a bonus, so
      // a failure here never blocks or toasts.
      ai.generateInsights(wsId)
        .then(() => qc.invalidateQueries({ queryKey: ['momentum', wsId] }))
        .catch(() => {})
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save your check-in.'),
  })

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <Link to="/app" className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft size={15} /> Back to Launchpad
        </Link>
        <div className="flex items-center gap-2 text-text-3">
          <CalendarCheck size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">Weekly check-in</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          Look back on your week
        </h1>
        <p className="mt-1 text-sm text-text-2">
          {current ? `Week of ${format(new Date(current.weekOf + 'T12:00:00'), 'MMMM d')}` : 'A few honest minutes — what worked, what didn’t, what’s next.'}
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* This week, habit by habit */}
          {current && current.summary.length > 0 && (
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">This week, habit by habit</h2>
              <div className="space-y-2">
                {current.summary.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-1">{s.title}</p>
                      {s.redDots.length > 0 && (
                        <p className="text-xs text-text-3">Missed {s.redDots.join(', ')}</p>
                      )}
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                      s.hits >= s.scheduled ? 'bg-success/10 text-success' : 'bg-surface-2 text-text-2'
                    )}>
                      {s.hits}/{s.scheduled} {s.scheduleType === 'weekly' ? 'sessions' : 'days'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* The reflective conversation */}
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">Think it through</h2>
            <GuidedChat
              endpoint="/ai/checkin"
              extraBody={{ wsId }}
              messages={messages}
              onMessagesChange={setMessages}
              placeholder="Reflect honestly…"
              className="h-[44vh]"
            />
          </section>

          {/* Capture the outcome */}
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-text-2">Capture it</h2>

            <div className="mb-4">
              <label className="mb-2 block text-xs font-medium text-text-2">How did the week go?</label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={cn(
                      'h-9 w-9 rounded-lg text-sm font-medium transition-colors',
                      rating === n ? 'bg-accent text-white' : 'bg-surface-2 text-text-2 hover:text-text-1'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Input label="One tiny victory" placeholder="However small — it counts." value={tinyVictory} onChange={(e) => setTinyVictory(e.target.value)} />
              <Textarea label="What’s working" rows={2} value={workingWell} onChange={(e) => setWorkingWell(e.target.value)} />
              <Textarea label="What’s not working" rows={2} value={notWorking} onChange={(e) => setNotWorking(e.target.value)} />

              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-2">Plan for next week’s obstacles</label>
                <div className="space-y-2">
                  {obstacles.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-bg p-2.5">
                      <div className="flex-1 font-serif text-sm leading-relaxed text-text-1">
                        If{' '}
                        <input
                          className="mx-1 inline-block w-40 max-w-full border-b-2 border-accent bg-transparent px-1 font-sans text-sm focus:outline-none"
                          placeholder="the week gets busy"
                          value={row.obstacle}
                          onChange={(e) => setObstacles((rows) => rows.map((r, idx) => idx === i ? { ...r, obstacle: e.target.value } : r))}
                        />
                        , then I’ll{' '}
                        <input
                          className="mx-1 inline-block w-40 max-w-full border-b-2 border-accent bg-transparent px-1 font-sans text-sm focus:outline-none"
                          placeholder="do the 2-minute version"
                          value={row.plan}
                          onChange={(e) => setObstacles((rows) => rows.map((r, idx) => idx === i ? { ...r, plan: e.target.value } : r))}
                        />
                      </div>
                      <button type="button" onClick={() => setObstacles((rows) => rows.filter((_, idx) => idx !== i))} className="text-text-3 hover:text-danger" aria-label="Remove">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {obstacles.length < 5 && (
                    <button
                      type="button"
                      onClick={() => setObstacles((rows) => [...rows, { obstacle: '', plan: '' }])}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-sm font-medium text-text-2 hover:border-accent hover:text-text-1"
                    >
                      <Plus size={14} /> Add an if–then plan
                    </button>
                  )}
                </div>
              </div>

              <Textarea label="Anything else" rows={2} value={freeform} onChange={(e) => setFreeform(e.target.value)} />
            </div>

            <div className="mt-4">
              {current?.existing?.status === 'skipped' && (
                <p className="mb-2 text-xs text-text-3">You skipped this week — you can still fill it in.</p>
              )}
              <Button variant="primary" size="lg" loading={save.isPending} onClick={() => save.mutate()}>
                {current?.existing && current.existing.status !== 'skipped' ? 'Update this week’s check-in' : 'Save this week’s check-in'}
              </Button>
            </div>
          </section>

          {/* History */}
          {history && history.checkIns.length > 0 && (
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">Past check-ins</h2>
              <div className="space-y-2">
                {history.checkIns.map((c) => (
                  <div key={c.id} className="rounded-xl border border-border bg-bg p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-text-1">Week of {format(new Date(c.weekOf + 'T12:00:00'), 'MMM d')}</p>
                      {c.status === 'skipped'
                        ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-3">Skipped</span>
                        : c.rating != null && <span className="text-xs text-text-3">{c.rating}/10</span>}
                    </div>
                    {c.aiSummary && <p className="mt-1 text-sm text-text-2">{c.aiSummary}</p>}
                    {c.tinyVictory && <p className="mt-1 text-xs text-text-3">Win: {c.tinyVictory}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
