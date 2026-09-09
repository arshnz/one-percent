import { useState, useEffect } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { CalendarCheck, Plus, Trash2, ChevronDown, X } from 'lucide-react'
import { checkins as checkinsApi, habits as habitsApi, ai } from '@/lib/api'
import type { SetbackPlan, UnexplainedMiss } from '@/types'
import { mergeReasonChips } from '@/lib/missReasons'
import { GuidedChat, type ChatMessage } from '@/components/ai/GuidedChat'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

export function CheckInCard({ current, wsId, onSnooze }: { current: any, wsId: string, onSnooze?: () => void }) {
  const qc = useQueryClient()

  // Collapsed to a compact banner by default so it doesn't dominate the
  // Launchpad — the full review opens only when the user chooses to look back.
  const [open, setOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [rating, setRating] = useState<number | null>(null)
  const [tinyVictory, setTinyVictory] = useState('')
  const [workingWell, setWorkingWell] = useState('')
  const [notWorking, setNotWorking] = useState('')
  const [obstacles, setObstacles] = useState<SetbackPlan[]>([])
  const [freeform, setFreeform] = useState('')
  // Per-row picks for the "what got in the way?" sweep, keyed habitId|date.
  const [sweep, setSweep] = useState<Record<string, { reasons: string[]; note: string }>>({})

  useEffect(() => {
    if (!current) return
    const wins = current.summary.filter((s: any) => s.scheduled > 0)
    const openerBits =
      wins.length > 0
        ? `You showed up ${wins.reduce((a: any, s: any) => a + s.hits, 0)} times across ${wins.length} ${wins.length === 1 ? 'habit' : 'habits'} this week. Let's look back together — no scores, just an honest look.`
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
      let aiSummary: string | null = null
      if (messages.filter((m) => m.role === 'user').length > 0) {
        try { aiSummary = (await ai.checkinSummary(messages)).summary } catch { aiSummary = null }
      }
      return checkinsApi.save(wsId, {
        weekOf: current.weekOf,
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

  // "Not this week" — records a skipped row so the card stays gone until
  // Monday and the week shows honestly in history.
  const skip = useMutation({
    mutationFn: () => checkinsApi.skip(wsId, { weekOf: current.weekOf }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checkin-current', wsId] })
      qc.invalidateQueries({ queryKey: ['checkins', wsId] })
      toast.success('Skipped this week — see you Monday.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not skip the check-in.'),
  })

  // Batch-save the sweep: one reason call per answered miss. Entirely optional —
  // the check-in itself saves independently.
  const misses: UnexplainedMiss[] = current?.unexplainedMisses ?? []
  const answered = misses.filter((m) => {
    const row = sweep[`${m.habitId}|${m.date}`]
    return row && (row.reasons.length > 0 || row.note.trim())
  })
  const saveReasons = useMutation({
    mutationFn: () =>
      Promise.all(
        answered.map((m) => {
          const row = sweep[`${m.habitId}|${m.date}`]
          return habitsApi.logReason(wsId, m.habitId, {
            date: m.date,
            reasons: row.reasons,
            note: row.note.trim() || null,
          })
        })
      ),
    onSuccess: () => {
      setSweep({})
      qc.invalidateQueries({ queryKey: ['checkin-current', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      toast.success('Noted — that’s next week’s plan taking shape.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save those reasons.'),
  })

  function toggleSweepChip(key: string, chip: string) {
    setSweep((s) => {
      const row = s[key] ?? { reasons: [], note: '' }
      const reasons = row.reasons.includes(chip)
        ? row.reasons.filter((c) => c !== chip)
        : row.reasons.length >= 5 ? row.reasons : [...row.reasons, chip]
      return { ...s, [key]: { ...row, reasons } }
    })
  }

  if (!current) return null

  return (
    <div className="mb-8 overflow-hidden rounded-[20px] border border-[#CBD8CE]" style={{ background: '#F1F6F2' }}>
      {/* Header — expand/collapse the full review, plus a dismiss control.
          The dismiss button can't nest inside the expand button, so the header
          is a flex row of the two. */}
      <div className="relative flex w-full items-start gap-2 p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2" style={{ color: '#2F9E6E' }}>
              <CalendarCheck size={16} />
              <span className="text-[11px] font-semibold uppercase tracking-widest">Weekly check-in</span>
            </div>
            <h2 className="font-sans text-[20px] font-bold tracking-tight text-[#1B1A17]">
              Look back on your week
            </h2>
            <p className="mt-0.5 text-[13.5px]" style={{ color: '#6F6B62' }}>
              {open
                ? <>Week of {format(new Date(current.weekOf + 'T12:00:00'), 'MMMM d')} &middot; A few honest minutes</>
                : 'A few honest minutes, when you’re ready. Tap to look back.'}
            </p>
          </div>
          <ChevronDown
            size={20}
            className="shrink-0 transition-transform"
            style={{ color: '#2F9E6E', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        <button
          type="button"
          onClick={() => setDismissOpen((v) => !v)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-[rgba(0,0,0,0.05)]"
          style={{ color: '#8A9E8E' }}
          aria-label="Dismiss the check-in"
          aria-expanded={dismissOpen}
        >
          <X size={16} />
        </button>

        {dismissOpen && (
          <div
            className="absolute right-4 top-14 z-10 w-52 overflow-hidden rounded-[12px] bg-white shadow-lg"
            style={{ border: '1px solid #CBD8CE' }}
          >
            <button
              type="button"
              onClick={() => { setDismissOpen(false); onSnooze?.() }}
              className="block w-full px-3.5 py-2.5 text-left text-[13.5px] font-medium text-[#1B1A17] transition-colors hover:bg-[#F1F6F2]"
            >
              Snooze until tomorrow
            </button>
            <button
              type="button"
              disabled={skip.isPending}
              onClick={() => { setDismissOpen(false); skip.mutate() }}
              className="block w-full px-3.5 py-2.5 text-left text-[13.5px] font-medium text-[#1B1A17] transition-colors hover:bg-[#F1F6F2] disabled:opacity-50"
              style={{ borderTop: '1px solid #E4EDE6' }}
            >
              Skip this week
            </button>
          </div>
        )}
      </div>

      {open && (
      <div className="px-5 pb-6 space-y-5" style={{ borderTop: '1px solid #CBD8CE' }}>
        {/* This week, habit by habit */}
        {current.summary.length > 0 && (
          <section className="pt-5">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6F6B62' }}>This week</h3>
            <div className="space-y-2">
              {current.summary.map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-[12px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid #C2D4C6' }}>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-[#1B1A17]">{s.title}</p>
                    {s.redDots.length > 0 && (
                      <p className="text-[12px]" style={{ color: '#8A9E8E' }}>Missed {s.redDots.join(', ')}</p>
                    )}
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
                  )} style={{ background: s.hits >= s.scheduled ? 'rgba(47,158,110,0.12)' : 'rgba(0,0,0,0.06)', color: s.hits >= s.scheduled ? '#2F9E6E' : '#8A9E8E' }}>
                    {s.hits}/{s.scheduled} {s.scheduleType === 'weekly' ? 'sessions' : 'days'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* What got in the way? — the week's misses that never got a reason.
            Naming them here feeds the obstacle patterns and the coach. */}
        {misses.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6F6B62' }}>What got in the way?</h3>
            <p className="mb-3 text-[12.5px]" style={{ color: '#8A9E8E' }}>
              A few scheduled days slipped by — naming why helps next week’s plan. Skip any you like.
            </p>
            <div className="space-y-2">
              {misses.map((m) => {
                const key = `${m.habitId}|${m.date}`
                const row = sweep[key] ?? { reasons: [], note: '' }
                const chips = mergeReasonChips(null, m.obstacles)
                return (
                  <div key={key} className="rounded-[12px] p-3" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid #C2D4C6' }}>
                    <p className="mb-2 text-[13px] font-medium text-[#1B1A17]">
                      {m.habitTitle} <span className="font-normal" style={{ color: '#8A9E8E' }}>· {m.weekdayName}</span>
                    </p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {chips.map((chip) => {
                        const active = row.reasons.includes(chip)
                        return (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => toggleSweepChip(key, chip)}
                            className="rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors"
                            style={
                              active
                                ? { background: '#2F9E6E', color: '#fff', borderColor: '#2F9E6E' }
                                : { background: 'rgba(255,255,255,0.7)', color: '#6F6B62', borderColor: '#C2D4C6' }
                            }
                          >
                            {chip}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      type="text"
                      value={row.note}
                      onChange={(e) => setSweep((s) => ({ ...s, [key]: { ...(s[key] ?? { reasons: [] }), reasons: (s[key]?.reasons ?? []), note: e.target.value } }))}
                      maxLength={500}
                      placeholder="Anything else? (optional)"
                      className="w-full rounded-[10px] bg-transparent px-2.5 py-1.5 text-[13px] text-[#1B1A17] placeholder:text-[#8A9E8E] focus:outline-none"
                      style={{ border: '1px solid #C2D4C6' }}
                    />
                  </div>
                )
              })}
            </div>
            {answered.length > 0 && (
              <Button
                variant="secondary"
                size="md"
                className="mt-3"
                loading={saveReasons.isPending}
                onClick={() => saveReasons.mutate()}
              >
                Save {answered.length === 1 ? 'this reason' : `${answered.length} reasons`}
              </Button>
            )}
          </section>
        )}

        {/* Reflective conversation */}
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6F6B62' }}>Think it through</h3>
          <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid #C2D4C6' }}>
            <GuidedChat
              endpoint="/ai/checkin"
              extraBody={{ wsId }}
              messages={messages}
              onMessagesChange={setMessages}
              placeholder="Reflect honestly..."
              className="h-[32vh]"
            />
          </div>
        </section>

        {/* Capture the outcome */}
        <section>
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6F6B62' }}>Capture it</h3>

          <div className="mb-4">
            <label className="mb-2 block text-[13px] font-medium" style={{ color: '#4A6B52' }}>How did the week go?</label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className="h-9 w-9 rounded-lg text-sm font-medium transition-colors"
                  style={
                    rating === n
                      ? { background: '#2F9E6E', color: '#fff' }
                      : { background: 'rgba(255,255,255,0.7)', color: '#6F6B62', border: '1px solid #C2D4C6' }
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Input label="One tiny victory" placeholder="However small - it counts." value={tinyVictory} onChange={(e) => setTinyVictory(e.target.value)} />
            <Textarea label="What's working" rows={2} value={workingWell} onChange={(e) => setWorkingWell(e.target.value)} />
            <Textarea label="What's not working" rows={2} value={notWorking} onChange={(e) => setNotWorking(e.target.value)} />

            <div>
              <label className="mb-2 block text-[13px] font-medium" style={{ color: '#4A6B52' }}>Plan for next week's obstacles</label>
              <div className="space-y-2">
                {obstacles.map((row, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-[12px] p-2.5" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid #C2D4C6' }}>
                    <div className="flex-1 font-serif text-[14px] leading-relaxed text-[#1B1A17]">
                      If{' '}
                      <input
                        className="mx-1 inline-block w-36 max-w-full border-b-2 bg-transparent px-1 font-sans text-sm focus:outline-none"
                        style={{ borderColor: '#2F9E6E' }}
                        placeholder="the week gets busy"
                        value={row.obstacle}
                        onChange={(e) => setObstacles((rows) => rows.map((r, idx) => idx === i ? { ...r, obstacle: e.target.value } : r))}
                      />
                      , then I'll{' '}
                      <input
                        className="mx-1 inline-block w-36 max-w-full border-b-2 bg-transparent px-1 font-sans text-sm focus:outline-none"
                        style={{ borderColor: '#2F9E6E' }}
                        placeholder="do the 2-minute version"
                        value={row.plan}
                        onChange={(e) => setObstacles((rows) => rows.map((r, idx) => idx === i ? { ...r, plan: e.target.value } : r))}
                      />
                    </div>
                    <button type="button" onClick={() => setObstacles((rows) => rows.filter((_, idx) => idx !== i))} className="text-[#8A9E8E] hover:text-red-500 transition-colors" aria-label="Remove">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {obstacles.length < 5 && (
                  <button
                    type="button"
                    onClick={() => setObstacles((rows) => [...rows, { obstacle: '', plan: '' }])}
                    className="flex w-full items-center justify-center gap-1.5 rounded-[12px] py-2 text-[13px] font-medium transition-colors"
                    style={{ border: '1.5px dashed #C2D4C6', color: '#6F6B62' }}
                  >
                    <Plus size={14} /> Add an if-then plan
                  </button>
                )}
              </div>
            </div>

            <Textarea label="Anything else" rows={2} value={freeform} onChange={(e) => setFreeform(e.target.value)} />
          </div>

          <div className="mt-5 pt-4" style={{ borderTop: '1px solid #C2D4C6' }}>
            <Button variant="primary" size="lg" loading={save.isPending} onClick={() => save.mutate()}>
              {current.existing && current.existing.status !== 'skipped' ? "Update this week's check-in" : "Save this week's check-in"}
            </Button>
          </div>
        </section>
      </div>
      )}
    </div>
  )
}
