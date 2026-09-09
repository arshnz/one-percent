import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft, ArrowUpRight, Compass as CompassIcon, Hammer, Plus, Trash2, Sparkles, MessageCircle,
  Save, History, Eye, Download, X, Link2, RotateCcw, FlameKindling, RefreshCw,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { ai, auth as authApi, compass as compassApi, goals as goalsApi, habits as habitsApi } from '@/lib/api'
import type {
  CompassDraft, CompassAssessmentForm, CompassVision, CompassGoalForm,
  CompassSnapshotSummary, GoalDomain, Goal, Habit,
} from '@/types'
import { GuidedChat, type ChatMessage } from '@/components/ai/GuidedChat'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

// The Compass — the workbook's ABZ framework as a structured worksheet.
// A: your current reality. Z: where you want to end up. B: goals → the first
// habit. You fill it in directly (AI is an optional per-section helper) and move
// freely between sections. The worksheet is ALWAYS live: every autosave flows
// its goals + assessment straight into the rest of the app — no "make live"
// step. Snapshots are optional, read-only saved versions you can Restore.

type Section = 'A' | 'Z' | 'B' | 'history'

const DOMAINS: { value: GoalDomain; label: string }[] = [
  { value: 'health', label: 'Health' },
  { value: 'career', label: 'Career' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'money', label: 'Money' },
  { value: 'mind', label: 'Mind' },
]

const emptyDraft = (): Required<CompassDraft> => ({
  assessment: {},
  vision: {},
  goals: [],
})

// Stable client id for a worksheet goal, so it survives title edits — the
// server reconciles compass goals by this id, not their title.
const genGoalId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `g_${Date.now()}_${Math.random().toString(36).slice(2)}`

// Backfill ids onto any goals that predate them (legacy drafts/snapshots).
const withGoalIds = (goals: CompassGoalForm[] = []) =>
  goals.map((g) => (g.id ? g : { ...g, id: genGoalId() }))

// ── Small field helpers ──────────────────────────────────────────────────────

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <label className="text-sm font-medium text-text-1">{children}</label>
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">{children}</section>
}

// A growing list of single-line text entries (priorities, obstacles, …).
function ListField({ label, hint, values, onChange, placeholder }: {
  label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const rows = values.length ? values : ['']
  const set = (i: number, v: string) => onChange(rows.map((r, idx) => idx === i ? v : r))
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="space-y-2">
        {rows.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={v}
              onChange={(e) => set(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
            />
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="text-text-3 hover:text-danger" aria-label="Remove">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...values, ''])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
        <Plus size={13} /> Add another
      </button>
    </div>
  )
}

// A 1–5 rating strip.
function Rating({ value, onChange }: { value?: number | null; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            'grid h-9 w-9 place-items-center rounded-lg border text-sm font-semibold transition-colors',
            value === n ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-text-2 hover:border-accent/50'
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

// ── AI helper (optional, per section) ────────────────────────────────────────

function AIHelper({ stage, canPull, onPull, pulling }: {
  stage: 'reality' | 'vision' | 'first-step'
  canPull: boolean
  onPull?: (messages: ChatMessage[]) => void
  pulling?: boolean
}) {
  const [open, setOpen] = useState(false)
  const openers: Record<typeof stage, string> = {
    reality: "Want to talk it through? Tell me roughly how life is feeling right now and I'll help you get it onto the page — then you can pull my read into the form.",
    vision: "Let's dream a little. A few years out, if things went the way you wanted, what would your life look like? Say the first thing that comes to mind.",
    'first-step': "Looking at your goals, which one feels most alive right now — the one you'd most regret not moving on this year? Let's find the one small habit that starts it.",
  }
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'model', text: openers[stage] }])
  const hasUserTurn = messages.some((m) => m.role === 'user')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-accent/50 hover:text-text-1"
      >
        <Sparkles size={13} className="text-accent" /> Talk it through with AI
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-text-2">
          <MessageCircle size={13} /> Talk it through
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-text-3 hover:text-text-1" aria-label="Close AI helper">
          <X size={15} />
        </button>
      </div>
      <GuidedChat
        endpoint="/ai/compass"
        extraBody={{ stage }}
        messages={messages}
        onMessagesChange={setMessages}
        placeholder="Say it in your own words…"
        className="h-[42vh]"
      />
      {canPull && (
        <div className="mt-3 border-t border-border pt-3">
          <Button variant="secondary" size="sm" disabled={!hasUserTurn || pulling} loading={pulling} onClick={() => onPull?.(messages)}>
            <Download size={13} className="mr-1 inline" /> Pull answers into the form
          </Button>
          <p className="mt-1.5 text-[11px] text-text-3">Fills the fields above from this chat. You can edit everything after.</p>
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CompassPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)!
  const setUser = useAuthStore((s) => s.setUser)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [section, setSection] = useState<Section>('A')
  const [draft, setDraft] = useState<Required<CompassDraft>>(emptyDraft())
  const [loaded, setLoaded] = useState(false)
  const [label, setLabel] = useState('')
  const [viewingId, setViewingId] = useState<string | null>(null)

  // Seed the form from a one-shot fetch (not a cached query — the persistent
  // react-query cache would otherwise hydrate a stale copy and race the load).
  // The draft IS the live worksheet; there's nothing to "make live".
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    ;(async () => {
      try {
        const { draft: d } = await compassApi.getDraft(wsId)
        if (cancelled) return
        if (d) setDraft({ assessment: d.assessment ?? {}, vision: d.vision ?? {}, goals: withGoalIds(d.goals) })
      } catch { /* noop */ }
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [wsId])

  const snapshots = useQuery({ queryKey: ['compass-snapshots', wsId], queryFn: () => compassApi.listSnapshots(wsId) })
  const liveGoals = useQuery({ queryKey: ['goals', wsId], queryFn: () => goalsApi.list(wsId) })
  const roster = useQuery({ queryKey: ['habits', wsId], queryFn: () => habitsApi.list(wsId) })

  // Link an unassigned habit to one of the live goals.
  const assignGoal = useMutation({
    mutationFn: ({ habitId, goalId }: { habitId: string; goalId: string }) => habitsApi.update(wsId, habitId, { goalId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['goals', wsId] })
      toast.success('Linked to your goal.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not link the habit.'),
  })

  // Debounced autosave whenever the draft changes (after the initial load).
  // Saving the draft syncs goals + assessment into the app server-side — the
  // worksheet is always live, so refresh the goals the rest of the app reads.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      compassApi.saveDraft(wsId, draft)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['goals', wsId] })
          qc.invalidateQueries({ queryKey: ['today', wsId] })
        })
        .catch(() => {})
    }, 700)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [draft, loaded, wsId, qc])

  // Field setters.
  const setA = (patch: Partial<CompassAssessmentForm>) => setDraft((d) => ({ ...d, assessment: { ...d.assessment, ...patch } }))
  const setZ = (patch: Partial<CompassVision>) => setDraft((d) => ({ ...d, vision: { ...d.vision, ...patch } }))
  const setGoals = (fn: (g: CompassGoalForm[]) => CompassGoalForm[]) => setDraft((d) => ({ ...d, goals: fn(d.goals) }))

  const a = draft.assessment
  const z = draft.vision

  // AI "pull answers" — merge extracted structure into the form without clobbering.
  const pullA = useMutation({
    mutationFn: (messages: ChatMessage[]) => ai.compassExtract(messages),
    onSuccess: ({ extract }) => {
      const ex = extract.assessment
      const patch: Partial<CompassAssessmentForm> = {}
      const personal = ex.contentment?.find((c) => /person/i.test(c.domain))
      const professional = ex.contentment?.find((c) => /prof|work|career/i.test(c.domain))
      if (personal && a.contentmentPersonal == null) patch.contentmentPersonal = personal.score
      if (professional && a.contentmentProfessional == null) patch.contentmentProfessional = professional.score
      if (ex.priorities?.length && !(a.priorities?.length)) patch.priorities = ex.priorities
      if (ex.highQualityHours && !a.highQualityHours) patch.highQualityHours = ex.highQualityHours
      if (ex.obstacles?.length && !(a.obstacles?.length)) patch.obstacles = ex.obstacles
      if (ex.pastStickyHabits?.length && !(a.pastStickyHabits?.length)) patch.pastStickyHabits = ex.pastStickyHabits
      setA(patch)
      toast.success('Pulled into your worksheet — edit anything that isn’t quite you.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not read the chat.'),
  })

  const pullZ = useMutation({
    mutationFn: (messages: ChatMessage[]) => ai.compassExtract(messages),
    onSuccess: ({ extract }) => {
      const existing = new Set(draft.goals.map((g) => g.title.trim().toLowerCase()))
      const fresh = extract.goals
        .filter((g) => g.title.trim() && !existing.has(g.title.trim().toLowerCase()))
        .map((g) => ({ id: genGoalId(), title: g.title, domain: g.domain, whyText: g.whyText, timeframe: g.timeframe }))
      if (!fresh.length) { toast('No new goals to add yet — talk it through a bit more.', { icon: '🧭' }); return }
      setGoals((gs) => [...gs, ...fresh])
      toast.success(`Added ${fresh.length} goal${fresh.length === 1 ? '' : 's'} — refine them below.`)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not read the chat.'),
  })

  // Freeze the current worksheet into a read-only saved version (history).
  const saveSnapshot = useMutation({
    mutationFn: () => compassApi.createSnapshot(wsId, { label: label.trim() || undefined }),
    onSuccess: () => {
      setLabel('')
      qc.invalidateQueries({ queryKey: ['compass-snapshots', wsId] })
      toast.success('Snapshot saved.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save the snapshot.'),
  })

  // Restore a saved version back into the live worksheet — its goals + assessment
  // re-sync to match, since the worksheet is always live.
  const restore = useMutation({
    mutationFn: (id: string) => compassApi.restoreSnapshot(wsId, id),
    onSuccess: async ({ draft: d }) => {
      setDraft({ assessment: d.assessment ?? {}, vision: d.vision ?? {}, goals: withGoalIds(d.goals) })
      await afterSync()
      toast.success('Restored into your worksheet.')
      setSection('A')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not restore.'),
  })

  const deleteSnapshot = useMutation({
    mutationFn: (id: string) => compassApi.deleteSnapshot(wsId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compass-snapshots', wsId] }); if (viewingId) setViewingId(null) },
    onError: (e: any) => toast.error(e?.message ?? 'Could not delete.'),
  })

  // Start fresh: shelves compass goals, pauses linked habits, clears the
  // assessment, and blanks the worksheet.
  const resetWorksheet = useMutation({
    mutationFn: () => compassApi.resetWorksheet(wsId),
    onSuccess: async () => {
      setDraft(emptyDraft())
      setSection('A')
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      await afterSync()
      toast.success('Cleared. Starting fresh.')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not clear the worksheet.'),
  })

  // The worksheet syncs goals + User.assessment server-side — refresh both.
  async function afterSync() {
    qc.invalidateQueries({ queryKey: ['goals', wsId] })
    qc.invalidateQueries({ queryKey: ['today', wsId] })
    try { const { user } = await authApi.me(); setUser(user) } catch { /* noop */ }
  }

  const viewing = useQuery({
    queryKey: ['compass-snapshot', wsId, viewingId],
    queryFn: () => compassApi.getSnapshot(wsId, viewingId!),
    enabled: !!viewingId,
  })

  const goalsList: Goal[] = liveGoals.data?.goals ?? []
  const goalIdFor = (title: string) => goalsList.find((g) => g.title.trim().toLowerCase() === title.trim().toLowerCase())?.id ?? null
  const activeGoals = goalsList.filter((g) => g.status === 'active')

  const allHabits: Habit[] = roster.data?.habits ?? []
  const habitsForGoal = (goalId: string | null) => goalId ? allHabits.filter((h) => h.goalId === goalId && !h.archivedAt) : []
  const unassignedHabits = allHabits.filter((h) => !h.goalId && !h.archivedAt)

  const designHabit = (goal: CompassGoalForm) => {
    const seed = goal.idealSystem?.trim() || goal.currentSystem?.trim() || goal.title
    navigate('/app/architect', {
      state: { prefill: { kind: 'build' }, goalId: goalIdFor(goal.title), atomizerSeed: seed },
    })
  }

  const TABS: { key: Section; label: string }[] = [
    { key: 'A', label: 'A · Where you are' },
    { key: 'Z', label: 'Z · Where you’re heading' },
    { key: 'B', label: 'B · Goals → first habit' },
    { key: 'history', label: 'Snapshots' },
  ]

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <Link to="/app" className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft size={15} /> Back to Launchpad
        </Link>
        <div className="flex items-center gap-2 text-text-3">
          <CompassIcon size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">The Compass</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text-1">Set your bearings</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success">
            <Save size={11} /> Autosaves — goals sync live
          </span>
        </div>
        <p className="mt-1 text-sm text-text-2">
          Where you are (A), where you’re heading (Z), and the one habit that starts the path (B). Fill it in your own words — it autosaves as you go.
        </p>

        {/* Section tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                section === t.key ? 'border-accent bg-accent text-white' : 'border-border bg-surface-2 text-text-2 hover:border-accent/50'
              )}
            >
              {t.key === 'history' ? <History size={12} className="mr-1 inline" /> : null}
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {section === 'A' && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-text-1">Your current reality</h2>
            <div className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <FieldLabel hint="How content are you, 1–5?">Personal life</FieldLabel>
                  <Rating value={a.contentmentPersonal} onChange={(n) => setA({ contentmentPersonal: n })} />
                  <Textarea label="" rows={2} placeholder="Why that number?" value={a.contentmentPersonalWhy ?? ''} onChange={(e) => setA({ contentmentPersonalWhy: e.target.value })} />
                </div>
                <div>
                  <FieldLabel hint="How content are you, 1–5?">Professional life</FieldLabel>
                  <Rating value={a.contentmentProfessional} onChange={(n) => setA({ contentmentProfessional: n })} />
                  <Textarea label="" rows={2} placeholder="Why that number?" value={a.contentmentProfessionalWhy ?? ''} onChange={(e) => setA({ contentmentProfessionalWhy: e.target.value })} />
                </div>
              </div>
              <ListField label="Top priorities right now" hint="The two or three that actually matter." values={a.priorities ?? []} onChange={(v) => setA({ priorities: v })} placeholder="e.g. Be present with the kids" />
              <div>
                <FieldLabel hint="Everyone gets only a few genuinely high-quality hours a day.">Your best hours</FieldLabel>
                <Input label="" value={a.highQualityHours ?? ''} onChange={(e) => setA({ highQualityHours: e.target.value })} placeholder="e.g. 6–8am before the house wakes" />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <ListField label="What’s working well" values={a.workingWell ?? []} onChange={(v) => setA({ workingWell: v })} />
                <ListField label="What isn’t working" values={a.notWorking ?? []} onChange={(v) => setA({ notWorking: v })} />
              </div>
              <ListField label="What keeps knocking you off course" hint="The obstacles that show up when you try to change." values={a.obstacles ?? []} onChange={(v) => setA({ obstacles: v })} />
              <PastHabits value={a.pastStickyHabits ?? []} onChange={(v) => setA({ pastStickyHabits: v })} />
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <AIHelper stage="reality" canPull onPull={(m) => pullA.mutate(m)} pulling={pullA.isPending} />          </div>
        </div>
      )}

      {section === 'Z' && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-display text-lg font-semibold text-text-1">Where you want to end up</h2>
            <div className="space-y-5">
              <div>
                <FieldLabel hint="Forget your current commitments for a moment.">Dream big — what does the life look like?</FieldLabel>
                <Textarea label="" rows={3} value={z.dreamBig ?? ''} onChange={(e) => setZ({ dreamBig: e.target.value })} placeholder="If it were going the way you want…" />
              </div>
              <div>
                <FieldLabel>What does success mean to you?</FieldLabel>
                <Textarea label="" rows={2} value={z.successMeaning ?? ''} onChange={(e) => setZ({ successMeaning: e.target.value })} />
              </div>
              <div>
                <FieldLabel hint="A line each — leave blank any that don’t matter to you.">Your vision by life domain</FieldLabel>
                <div className="space-y-2">
                  {DOMAINS.map((d) => {
                    const cur = (z.domainVisions ?? []).find((v) => v.domain === d.value)?.vision ?? ''
                    return (
                      <div key={d.value} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-xs font-medium text-text-2">{d.label}</span>
                        <input
                          value={cur}
                          onChange={(e) => {
                            const others = (z.domainVisions ?? []).filter((v) => v.domain !== d.value)
                            setZ({ domainVisions: e.target.value ? [...others, { domain: d.value, vision: e.target.value }] : others })
                          }}
                          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
                          placeholder="…"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div><FieldLabel>Six months</FieldLabel><Textarea label="" rows={3} value={z.timeline6mo ?? ''} onChange={(e) => setZ({ timeline6mo: e.target.value })} /></div>
                <div><FieldLabel>Two years</FieldLabel><Textarea label="" rows={3} value={z.timeline2yr ?? ''} onChange={(e) => setZ({ timeline2yr: e.target.value })} /></div>
                <div><FieldLabel>Ten years</FieldLabel><Textarea label="" rows={3} value={z.timeline10yr ?? ''} onChange={(e) => setZ({ timeline10yr: e.target.value })} /></div>
              </div>
              <div>
                <FieldLabel hint="Who do you hope to be? Behaviour follows identity.">Your ideal identity</FieldLabel>
                <Textarea label="" rows={2} value={z.idealIdentity ?? ''} onChange={(e) => setZ({ idealIdentity: e.target.value })} placeholder="I am someone who…" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-text-1">Your concrete goals</h2>
              <button onClick={() => setGoals((gs) => [...gs, { id: genGoalId(), title: '', domain: 'health', whyText: '', timeframe: '' }])} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
                <Plus size={13} /> Add goal
              </button>
            </div>
            <p className="mb-4 text-xs text-text-3">The destinations your habits will serve. Big-picture is fine — these become live goals when you set a snapshot live.</p>
            {draft.goals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-bg p-4 text-sm text-text-3">No goals yet. Add one above, or use the AI helper to pull some in.</p>
            ) : (
              <div className="space-y-3">
                {draft.goals.map((g, i) => (
                  <GoalEditor key={i} goal={g} onChange={(patch) => setGoals((gs) => gs.map((r, idx) => idx === i ? { ...r, ...patch } : r))} onRemove={() => setGoals((gs) => gs.filter((_, idx) => idx !== i))} />
                ))}
              </div>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <AIHelper stage="vision" canPull onPull={(m) => pullZ.mutate(m)} pulling={pullZ.isPending} />          </div>
        </div>
      )}

      {section === 'B' && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-1 font-display text-lg font-semibold text-text-1">Goals → systems → the first habit</h2>
            <p className="mb-4 text-sm text-text-2">
              Z is your goal; B is the first habit of the system that gets you there. For each goal, sketch the system — then hand one habit to the Architect to engineer properly.
            </p>
            {draft.goals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-bg p-4 text-sm text-text-3">
                Add some goals in the <button onClick={() => setSection('Z')} className="font-medium text-accent underline">Z section</button> first.
              </p>
            ) : (
              <div className="space-y-4">
                {draft.goals.map((g, i) => (
                  <div key={i} className="rounded-xl border border-border bg-bg p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-2">{DOMAINS.find((d) => d.value === g.domain)?.label}</span>
                      <span className="text-sm font-semibold text-text-1">{g.title || <span className="text-text-3">Untitled goal</span>}</span>
                    </div>
                    <div className="space-y-3">
                      <div><FieldLabel hint="What are you doing now? Write “none” if nothing.">Current system</FieldLabel><Textarea label="" rows={2} value={g.currentSystem ?? ''} onChange={(e) => setGoals((gs) => gs.map((r, idx) => idx === i ? { ...r, currentSystem: e.target.value } : r))} /></div>
                      <div><FieldLabel hint="What would the ideal system for YOU look like?">Ideal system</FieldLabel><Textarea label="" rows={2} value={g.idealSystem ?? ''} onChange={(e) => setGoals((gs) => gs.map((r, idx) => idx === i ? { ...r, idealSystem: e.target.value } : r))} /></div>
                    </div>
                    {(() => {
                      const linked = habitsForGoal(goalIdFor(g.title))
                      if (!linked.length) return null
                      return (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">Habits serving this goal</p>
                          <ul className="space-y-1.5">
                            {linked.map((h) => (
                              <li key={h.id}>
                                <button
                                  onClick={() => navigate(`/app/architect/${h.id}`)}
                                  className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-text-1 hover:border-accent/50"
                                >
                                  <span className="truncate">
                                    {h.title}
                                    {h.pausedAt && <span className="ml-2 text-[11px] text-text-3">paused</span>}
                                  </span>
                                  <ArrowUpRight size={14} className="shrink-0 text-text-3 group-hover:text-accent" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-text-3">{goalIdFor(g.title) ? 'Linked to your live goal.' : 'Give this goal a title — it links automatically.'}</p>
                      <Button variant="primary" size="sm" disabled={!g.title.trim()} onClick={() => designHabit(g)}>
                        <Hammer size={13} className="mr-1 inline" /> Design this habit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {unassignedHabits.length > 0 && (
            <Card>
              <div className="mb-1 flex items-center gap-2 text-text-2">
                <Link2 size={14} />
                <h2 className="text-xs font-semibold uppercase tracking-widest">Unassigned habits</h2>
              </div>
              <p className="mb-3 text-xs text-text-3">
                These aren’t linked to a goal yet — habits stick better when they serve something bigger. Pick a goal for each.
              </p>
              <ul className="space-y-2">
                {unassignedHabits.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-bg p-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">{h.title}</span>
                    <select
                      defaultValue=""
                      disabled={assignGoal.isPending || activeGoals.length === 0}
                      onChange={(e) => { if (e.target.value) assignGoal.mutate({ habitId: h.id, goalId: e.target.value }) }}
                      className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text-1 focus:border-accent focus:outline-none disabled:opacity-50"
                      aria-label={`Link ${h.title} to a goal`}
                    >
                      <option value="" disabled>Link to a goal…</option>
                      {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
              {activeGoals.length === 0 && (
                <p className="mt-2 text-[11px] text-text-3">Add a goal in the Z section first — it becomes linkable straight away.</p>
              )}
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <AIHelper stage="first-step" canPull={false} />          </div>
        </div>
      )}

      {section === 'history' && (
        <div className="space-y-4">
          <Card>
            <div className="mb-1 flex items-center gap-2 text-text-2">
              <Save size={14} />
              <h2 className="text-xs font-semibold uppercase tracking-widest">Save a snapshot</h2>
            </div>
            <p className="mb-3 text-xs text-text-3">Your worksheet is already live — goals sync as you go. A snapshot just freezes a read-only copy of this moment you can look back on or Restore later.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Winter reset" className="min-w-[180px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none" />
              <Button variant="primary" size="sm" loading={saveSnapshot.isPending} onClick={() => saveSnapshot.mutate()}>Save snapshot</Button>
            </div>
          </Card>

          <Card>
            <div className="mb-1 flex items-center gap-2 text-text-2">
              <History size={14} />
              <h2 className="text-xs font-semibold uppercase tracking-widest">Your snapshots</h2>
            </div>
            <p className="mb-3 text-xs text-text-3">Read-only saved versions. <span className="font-medium text-text-2">Restore</span> one to load it back into your live worksheet.</p>
            {snapshots.isLoading ? (
              <p className="text-sm text-text-3">Loading…</p>
            ) : !snapshots.data?.snapshots.length ? (
              <p className="rounded-xl border border-dashed border-border bg-bg p-4 text-sm text-text-3">No snapshots yet. Fill in the worksheet, then save one above.</p>
            ) : (
              <ul className="space-y-2">
                {snapshots.data.snapshots.map((s) => (
                  <SnapshotRow
                    key={s.id}
                    s={s}
                    onView={() => setViewingId(s.id)}
                    onRestore={() => { if (confirm('Restore this snapshot into your live worksheet? It replaces what’s there now — your current goals re-sync to match.')) restore.mutate(s.id) }}
                    onDelete={() => { if (confirm('Delete this snapshot? This can’t be undone.')) deleteSnapshot.mutate(s.id) }}
                    busy={restore.isPending}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-1 flex items-center gap-2 text-text-2">
              <FlameKindling size={14} />
              <h2 className="text-xs font-semibold uppercase tracking-widest">Start fresh</h2>
            </div>
            <p className="mb-3 text-xs text-text-3">Clear the worksheet and shelve its goals — linked habits pause (nothing owed, recoverable) and your assessment resets. Saved snapshots stay untouched.</p>
            <Button variant="secondary" size="sm" loading={resetWorksheet.isPending} onClick={() => { if (confirm('Clear your Compass? Goals will be shelved, linked habits paused, and your assessment cleared. Saved snapshots are kept.')) resetWorksheet.mutate() }}>
              <RefreshCw size={13} className="mr-1 inline" /> Clear worksheet &amp; start fresh
            </Button>
          </Card>
        </div>
      )}

      {viewingId && (
        <SnapshotViewer
          loading={viewing.isLoading}
          snapshot={viewing.data?.snapshot ?? null}
          onClose={() => setViewingId(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PastHabits({ value, onChange }: { value: { habit: string; whyItStuck: string }[]; onChange: (v: { habit: string; whyItStuck: string }[]) => void }) {
  const rows = value.length ? value : [{ habit: '', whyItStuck: '' }]
  const set = (i: number, patch: Partial<{ habit: string; whyItStuck: string }>) =>
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  return (
    <div>
      <FieldLabel hint="Habits that actually stuck before — and why. This is gold for the next one.">Past sticky habits</FieldLabel>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={r.habit} onChange={(e) => set(i, { habit: e.target.value })} placeholder="The habit" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none" />
            <input value={r.whyItStuck} onChange={(e) => set(i, { whyItStuck: e.target.value })} placeholder="Why it stuck" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none" />
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="text-text-3 hover:text-danger" aria-label="Remove"><Trash2 size={15} /></button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...(value.length ? value : []), { habit: '', whyItStuck: '' }])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
        <Plus size={13} /> Add another
      </button>
    </div>
  )
}

function GoalEditor({ goal, onChange, onRemove }: { goal: CompassGoalForm; onChange: (patch: Partial<CompassGoalForm>) => void; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <Input label="Goal" value={goal.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Run a half marathon" />
          <div className="flex flex-wrap gap-2">
            <select value={goal.domain} onChange={(e) => onChange({ domain: e.target.value as GoalDomain })} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text-1 focus:border-accent focus:outline-none" aria-label="Life domain">
              {DOMAINS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <input value={goal.timeframe ?? ''} onChange={(e) => onChange({ timeframe: e.target.value })} placeholder="by when? (optional)" className="min-w-[140px] flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none" />
          </div>
          <textarea value={goal.whyText ?? ''} onChange={(e) => onChange({ whyText: e.target.value })} rows={2} placeholder="why it matters" className="w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none" />
        </div>
        <button type="button" onClick={onRemove} className="mt-2 text-text-3 hover:text-danger" aria-label="Remove goal"><Trash2 size={15} /></button>
      </div>
    </div>
  )
}

function SnapshotRow({ s, onView, onRestore, onDelete, busy }: {
  s: CompassSnapshotSummary; onView: () => void; onRestore: () => void; onDelete: () => void; busy: boolean
}) {
  const when = new Date(s.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg p-3">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-1">{s.label || 'Untitled'}</span>
        <p className="text-xs text-text-3">{when} · {s.goalCount} goal{s.goalCount === 1 ? '' : 's'}</p>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onView} className="rounded-lg p-2 text-text-3 hover:bg-surface-2 hover:text-text-1" title="View"><Eye size={15} /></button>
        <button onClick={onRestore} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-2 hover:border-accent/50 hover:text-text-1 disabled:opacity-40" title="Restore into worksheet">
          <RotateCcw size={13} /> Restore
        </button>
        <button onClick={onDelete} className="rounded-lg p-2 text-text-3 hover:bg-surface-2 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
      </div>
    </li>
  )
}

function SnapshotViewer({ loading, snapshot, onClose }: { loading: boolean; snapshot: import('@/types').CompassSnapshot | null; onClose: () => void }) {
  const line = (label: string, value?: string | null) => value ? (
    <div><dt className="text-xs font-medium text-text-3">{label}</dt><dd className="text-sm text-text-1">{value}</dd></div>
  ) : null
  const list = (label: string, values?: string[]) => values?.filter(Boolean).length ? (
    <div><dt className="text-xs font-medium text-text-3">{label}</dt><dd className="text-sm text-text-1">{values.filter(Boolean).join(' · ')}</dd></div>
  ) : null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text-1">{snapshot?.label || 'Snapshot'}</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1" aria-label="Close"><X size={18} /></button>
        </div>
        {loading || !snapshot ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-2">A · Current reality</h3>
              <dl className="space-y-2">
                {line('Personal', snapshot.assessment.contentmentPersonal != null ? `${snapshot.assessment.contentmentPersonal}/5 — ${snapshot.assessment.contentmentPersonalWhy ?? ''}` : null)}
                {line('Professional', snapshot.assessment.contentmentProfessional != null ? `${snapshot.assessment.contentmentProfessional}/5 — ${snapshot.assessment.contentmentProfessionalWhy ?? ''}` : null)}
                {list('Priorities', snapshot.assessment.priorities)}
                {line('Best hours', snapshot.assessment.highQualityHours)}
                {list('Working well', snapshot.assessment.workingWell)}
                {list('Not working', snapshot.assessment.notWorking)}
                {list('Obstacles', snapshot.assessment.obstacles)}
                {snapshot.assessment.pastStickyHabits?.filter((p) => p.habit).length ? (
                  <div><dt className="text-xs font-medium text-text-3">Sticky habits</dt><dd className="text-sm text-text-1">{snapshot.assessment.pastStickyHabits.filter((p) => p.habit).map((p) => `${p.habit} (${p.whyItStuck})`).join(' · ')}</dd></div>
                ) : null}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-2">Z · Where you’re heading</h3>
              <dl className="space-y-2">
                {line('Dream big', snapshot.vision.dreamBig)}
                {line('Success means', snapshot.vision.successMeaning)}
                {line('Six months', snapshot.vision.timeline6mo)}
                {line('Two years', snapshot.vision.timeline2yr)}
                {line('Ten years', snapshot.vision.timeline10yr)}
                {line('Ideal identity', snapshot.vision.idealIdentity)}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-2">Goals</h3>
              {snapshot.goals.length ? (
                <ul className="space-y-1.5">
                  {snapshot.goals.map((g, i) => (
                    <li key={i} className="text-sm text-text-1">• {g.title} {g.timeframe ? <span className="text-text-3">— {g.timeframe}</span> : null}</li>
                  ))}
                </ul>
              ) : <p className="text-sm text-text-3">No goals captured.</p>}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
