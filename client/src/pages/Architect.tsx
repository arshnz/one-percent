import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Lock, Shield, Target, Pin, Hammer, Trash2, Plus, ArrowLeft,
  Clock, MapPin, Repeat, Flag, PartyPopper, Sparkles, Gauge, Check, X,
  Sprout, Ban, EyeOff, ShieldOff, PauseCircle, PlayCircle, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { habits as habitsApi, goals as goalsApi } from '@/lib/api'
import type { CreateHabitInput, Habit, CueType, HabitBlueprint, HabitKind, BreakMode, CheckStyle, ScheduleType, SetbackPlan, SectionNotes } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { BlueprintInterview } from '@/components/ai/BlueprintInterview'
import { scoreConcreteness, failSafeIsTiny } from '@/lib/concreteness'
import { cn } from '@/lib/utils'

// A step in the phase ladder. `id` is set only for steps that already exist on
// the server (an existing habit's locked upcoming phases) — new steps have none.
type LadderStep = { id?: string; targetText: string; definitionOfDone: string; targetCount: number; dailyLimit: number }

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6]

const CUE_TYPES: { value: CueType; label: string; icon: LucideIcon }[] = [
  { value: 'habit_stack', label: 'After a habit', icon: Repeat },
  { value: 'time', label: 'At a time', icon: Clock },
  { value: 'location', label: 'At a place', icon: MapPin },
]

// Only rows where both halves are filled make it into the saved plan.
function cleanSetbacks(rows: SetbackPlan[]): SetbackPlan[] {
  return rows
    .map((r) => ({ obstacle: r.obstacle.trim(), plan: r.plan.trim() }))
    .filter((r) => r.obstacle && r.plan)
}

// Trim each section note and drop the empty ones, so blank boxes don't persist.
function cleanNotes(notes: SectionNotes): SectionNotes {
  const out: SectionNotes = {}
  for (const k of ['cue', 'craving', 'response', 'reward', 'setbacks'] as const) {
    const v = notes[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

const empty = {
  kind: 'build' as HabitKind,
  goalId: '',
  breakMode: 'abstain' as BreakMode,
  checkStyle: 'hold' as CheckStyle,
  checkQuestion: '',
  avoidTrigger: '',
  replacementAction: '',
  frictionDevice: '',
  title: '',
  whyText: '',
  whyImageUrl: '',
  cueType: 'habit_stack' as CueType,
  anchorRoutine: '',
  cueTime: '',
  cueLocation: '',
  failSafeAction: '',
  celebration: '',
  temptationBundle: '',
  targetText: '',
  definitionOfDone: '',
  targetCount: 14,
  dailyLimit: 2,
  reminderTime: '',
  reminderEnabled: true,
  nightstandRule: '',
  systemFocusConfirmed: false,
}

// The worksheet's four laws + setbacks, each with a free-text "your own notes"
// box and a static menu of the workbook's other tactics (Habit Shortlist, p214).
// Kept kind-aware: build laws vs their inverted break counterparts.
type NoteKey = 'cue' | 'craving' | 'response' | 'reward' | 'setbacks'
const SECTION_SUGGESTIONS: Record<NoteKey, { build: string[]; break: string[] }> = {
  cue: {
    build: ['habit stacking', 'make cues obvious in your space'],
    break: ['identify & remove the cue', 'redesign the space to hide triggers'],
  },
  craving: {
    build: ['temptation bundling', 'try the fun version', 'a supportive circle'],
    break: ['reframe the mindset', 'find a better way to meet the craving'],
  },
  response: {
    build: ['two-minute rule', 'reduce friction', 'commitment device', 'master the decisive moment'],
    break: ['add friction', 'commitment device', 'master the decisive moment'],
  },
  reward: {
    build: ['an immediate reward', 'track your habits'],
    break: ['an accountability partner', 'a habit contract'],
  },
  setbacks: {
    build: ['never miss twice', 'plan the comeback before you need it'],
    break: ['never miss twice', 'plan the comeback before you need it'],
  },
}

export function ArchitectPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)!
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { id: editId } = useParams()
  // A "Convert to Habit Blueprint" action from the Vision Canvas lands here with
  // the extracted asset pre-filling the Why Board. The Compass additionally
  // hands over the goal this habit serves and a rough sentence for the Atomizer.
  const navState = location.state as { prefill?: Partial<typeof empty>; goalId?: string | null; atomizerSeed?: string } | null
  const prefill = navState?.prefill
  const atomizerSeed = navState?.atomizerSeed
  const [form, setForm] = useState({ ...empty, ...prefill, ...(navState?.goalId ? { goalId: navState.goalId } : {}) })
  const [days, setDays] = useState<number[]>([...DEFAULT_DAYS])
  // 'days' pins the habit to weekdays; 'weekly' asks for N reps on any days.
  const [scheduleType, setScheduleType] = useState<ScheduleType>('days')
  const [timesPerWeek, setTimesPerWeek] = useState(3)
  const [confirmedQuick, setConfirmedQuick] = useState(false)
  // Locked steps 2..N of the pre-mapped ladder (Phase 1 lives in `form`). In
  // edit mode these are the habit's existing locked upcoming phases plus any new
  // ones the user appends.
  const [extraPhases, setExtraPhases] = useState<LadderStep[]>([])
  // Ids of existing locked phases the user removed while editing — deleted on save.
  const [removedPhaseIds, setRemovedPhaseIds] = useState<string[]>([])
  // Workbook "Prepare for Setbacks": if/then recovery pairs, surfaced on danger days.
  const [setbacks, setSetbacks] = useState<SetbackPlan[]>([])
  // Free-text notes per worksheet section (the user's own tactics).
  const [sectionNotes, setSectionNotes] = useState<SectionNotes>({})
  const setNote = (k: NoteKey, v: string) => setSectionNotes((n) => ({ ...n, [k]: v }))
  // Edit mode: the habit being edited and its active/ready phase (if any).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['habits', wsId],
    queryFn: () => habitsApi.list(wsId),
    enabled: !!wsId,
  })

  const { data: goalsData } = useQuery({
    queryKey: ['goals', wsId],
    queryFn: () => goalsApi.list(wsId),
    enabled: !!wsId,
  })
  const activeGoals = (goalsData?.goals ?? []).filter((g) => g.status === 'active')

  function resetForm() {
    setForm({ ...empty })
    setDays([...DEFAULT_DAYS])
    setConfirmedQuick(false)
    setExtraPhases([])
    setRemovedPhaseIds([])
    setSetbacks([])
    setSectionNotes({})
    setEditingId(null)
    setEditingPhaseId(null)
  }

  // The Atomizer hands back a full blueprint — drop it straight into the form.
  function applyBlueprint(b: HabitBlueprint) {
    setForm((f) => ({
      ...f,
      kind: b.kind ?? f.kind,
      breakMode: b.breakMode ?? f.breakMode,
      avoidTrigger: b.avoidTrigger || '',
      replacementAction: b.replacementAction || '',
      frictionDevice: b.frictionDevice || '',
      title: b.identityStatement || f.title,
      whyText: b.why || f.whyText,
      cueType: b.cueType,
      anchorRoutine: b.anchorRoutine || '',
      cueTime: b.cueTime || '',
      cueLocation: b.cueLocation || '',
      reminderTime: b.cueTime || f.reminderTime,
      failSafeAction: b.failSafeAction || '',
      celebration: b.celebration || '',
      temptationBundle: b.temptationBundle || '',
      nightstandRule: b.nightstandRule || '',
      targetText: b.phases[0]?.targetText || '',
      definitionOfDone: b.phases[0]?.definitionOfDone || '',
      targetCount: b.phases[0]?.targetCount || 14,
      dailyLimit: b.phases[0]?.dailyLimit ?? f.dailyLimit,
    }))
    setExtraPhases(
      b.phases.slice(1).map((p) => ({
        targetText: p.targetText,
        definitionOfDone: p.definitionOfDone,
        targetCount: p.targetCount,
        dailyLimit: p.dailyLimit ?? 0,
      }))
    )
    toast.success('Draft ready — review and tweak before engineering.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addPhase = () =>
    setExtraPhases((p) => [...p, { targetText: '', definitionOfDone: '', targetCount: 21, dailyLimit: 0 }])
  const removePhase = (i: number) =>
    setExtraPhases((p) => {
      const row = p[i]
      if (row?.id) setRemovedPhaseIds((ids) => [...ids, row.id!])
      return p.filter((_, idx) => idx !== i)
    })
  const setPhase = (i: number, k: keyof LadderStep, v: string | number) =>
    setExtraPhases((p) => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))

  function startEdit(h: Habit) {
    const phase = h.phases.find((p) => p.status === 'active' || p.status === 'ready') ?? null
    setForm({
      kind: h.kind ?? 'build',
      goalId: h.goalId ?? '',
      breakMode: h.breakMode ?? 'abstain',
      checkStyle: h.checkStyle ?? 'hold',
      checkQuestion: h.checkQuestion ?? '',
      avoidTrigger: h.avoidTrigger ?? '',
      replacementAction: h.replacementAction ?? '',
      frictionDevice: h.frictionDevice ?? '',
      title: h.title,
      whyText: h.whyText ?? '',
      whyImageUrl: h.whyImageUrl ?? '',
      cueType: h.cueType,
      anchorRoutine: h.anchorRoutine ?? '',
      cueTime: h.cueTime ?? '',
      cueLocation: h.cueLocation ?? '',
      failSafeAction: h.failSafeAction,
      celebration: h.celebration ?? '',
      temptationBundle: h.temptationBundle ?? '',
      targetText: phase?.targetText ?? '',
      definitionOfDone: phase?.definitionOfDone ?? '',
      targetCount: phase?.targetCount ?? 14,
      dailyLimit: phase?.dailyLimit ?? 2,
      reminderTime: h.reminderTime ?? '',
      reminderEnabled: h.reminderEnabled ?? true,
      nightstandRule: h.nightstandRule ?? '',
      systemFocusConfirmed: h.systemFocusConfirmed ?? false,
    })
    try { setDays(JSON.parse(h.scheduleDays)) } catch { setDays([...DEFAULT_DAYS]) }
    setScheduleType(h.scheduleType === 'weekly' ? 'weekly' : 'days')
    if (h.timesPerWeek) setTimesPerWeek(h.timesPerWeek)
    try { setSetbacks(h.setbackPlans ? JSON.parse(h.setbackPlans) : []) } catch { setSetbacks([]) }
    try { setSectionNotes(h.sectionNotes ? JSON.parse(h.sectionNotes) : {}) } catch { setSectionNotes({}) }
    // Upcoming (locked) phases beyond the current milestone — editable, and the
    // user can append more or drop them.
    setExtraPhases(
      [...h.phases]
        .filter((p) => p.status === 'locked')
        .sort((a, b) => a.phaseNumber - b.phaseNumber)
        .map((p) => ({ id: p.id, targetText: p.targetText, definitionOfDone: p.definitionOfDone ?? '', targetCount: p.targetCount, dailyLimit: p.dailyLimit ?? 0 }))
    )
    setRemovedPhaseIds([])
    setConfirmedQuick(true) // already-saved habit was confirmed when created
    setEditingId(h.id)
    setEditingPhaseId(phase?.id ?? null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Enter edit mode when arriving via /app/architect/:id. If the id no longer
  // resolves to a habit (deleted, bad link), bounce back to the Launchpad.
  useEffect(() => {
    if (!editId || !data) return
    if (editingId === editId) return
    const h = data.habits.find((x) => x.id === editId)
    if (h) startEdit(h)
    else navigate('/app', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, data])

  const create = useMutation({
    mutationFn: (input: CreateHabitInput) => habitsApi.create(wsId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      toast.success('Habit engineered. Time to vote.')
      resetForm()
      navigate('/app')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save habit'),
  })

  const update = useMutation({
    mutationFn: async () => {
      const taperNow = form.kind === 'break' && form.breakMode === 'taper'
      await habitsApi.update(wsId, editingId!, {
        goalId: form.goalId || null,
        breakMode: form.kind === 'break' ? form.breakMode : null,
        checkStyle: taperNow ? 'hold' : form.checkStyle,
        checkQuestion: form.checkStyle === 'yesno' && !taperNow ? form.checkQuestion.trim() || null : null,
        avoidTrigger: form.kind === 'break' ? form.avoidTrigger.trim() || null : null,
        replacementAction: form.kind === 'break' ? form.replacementAction.trim() || null : null,
        frictionDevice: form.kind === 'break' ? form.frictionDevice.trim() || null : null,
        title: form.title.trim(),
        whyText: form.whyText.trim() || null,
        whyImageUrl: form.whyImageUrl.trim() || null,
        cueType: form.cueType,
        anchorRoutine: form.cueType === 'habit_stack' ? form.anchorRoutine.trim() : null,
        cueTime: form.cueType === 'time' ? form.cueTime.trim() : null,
        cueLocation: form.cueType === 'location' ? form.cueLocation.trim() : null,
        failSafeAction: form.failSafeAction.trim(),
        celebration: form.celebration.trim() || null,
        temptationBundle: form.temptationBundle.trim() || null,
        ...schedulePayload(),
        ...reminderPayload(),
        nightstandRule: form.nightstandRule.trim() || null,
        setbackPlans: cleanSetbacks(setbacks),
        systemFocusConfirmed: form.systemFocusConfirmed,
        sectionNotes: cleanNotes(sectionNotes),
      })
      // Phase target lives on the (non-graduated) active phase.
      if (editingPhaseId) {
        await habitsApi.updatePhase(wsId, editingId!, editingPhaseId, {
          targetText: form.targetText.trim(),
          definitionOfDone: form.definitionOfDone.trim() || null,
          targetCount: Number(form.targetCount),
          dailyLimit: form.kind === 'break' && form.breakMode === 'taper' ? Number(form.dailyLimit) : null,
        })
      }
      // Reconcile the upcoming (locked) ladder: drop removed steps, save edits to
      // existing ones, and append brand-new steps (locked behind the current).
      const taperLimit = form.kind === 'break' && form.breakMode === 'taper'
      for (const id of removedPhaseIds) {
        await habitsApi.deletePhase(wsId, editingId!, id)
      }
      for (const p of extraPhases) {
        const payload = {
          targetText: p.targetText.trim(),
          definitionOfDone: p.definitionOfDone.trim() || null,
          targetCount: Number(p.targetCount),
          dailyLimit: taperLimit ? Number(p.dailyLimit) : null,
        }
        if (p.id) await habitsApi.updatePhase(wsId, editingId!, p.id, payload)
        else await habitsApi.addPhase(wsId, editingId!, payload)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      toast.success('Habit updated.')
      resetForm()
      navigate('/app')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not update habit'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => habitsApi.remove(wsId, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['habits', wsId] })
      const prev = qc.getQueryData<{ habits: Habit[] }>(['habits', wsId])
      qc.setQueryData<{ habits: Habit[] }>(['habits', wsId], (old) =>
        old ? { ...old, habits: old.habits.filter((h) => h.id !== id) } : old
      )
      resetForm()
      navigate('/app')
      return { prev }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['habits', wsId], ctx.prev)
      toast.error('Could not archive habit')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
    },
  })

  const editingHabit = data?.habits.find((h) => h.id === editingId)
  const isPaused = !!editingHabit?.pausedAt

  const togglePause = useMutation({
    mutationFn: () => habitsApi.setPaused(wsId, editingId!, !isPaused),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      toast.success(isPaused ? 'Resumed — this habit’s live again.' : 'Paused. Resume it anytime from the Launchpad.')
      navigate('/app')
    },
    onError: () => toast.error('Could not update this habit'),
  })

  const set = (k: keyof typeof form, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))

  // The two modes are exclusive: a weekly quota ignores scheduleDays, and the
  // server clears timesPerWeek when you switch back to fixed days.
  const schedulePayload = () =>
    scheduleType === 'weekly'
      ? { scheduleType: 'weekly' as const, timesPerWeek }
      : { scheduleType: 'days' as const, scheduleDays: days, timesPerWeek: null }

  // The reminder fires at this time; falls back to a time-based cue when the
  // user didn't set a separate reminder time. Null when reminders are off.
  const reminderPayload = () => {
    if (!form.reminderEnabled) return { reminderEnabled: false, reminderTime: null }
    const t = form.reminderTime.trim() || (form.cueType === 'time' ? form.cueTime.trim() : '')
    return { reminderEnabled: true, reminderTime: t || null }
  }

  // Blueprint checks (science guardrails): the fail-safe must be one genuinely
  // tiny action that fits the 2-minute rule.
  const fs = form.failSafeAction.trim()
  const failSafeTooLong = fs.length > 0 && !failSafeIsTiny(fs)

  // Cap of 6 active habits — six slots on the Launchpad. Archive one to add another.
  const activeCount = data?.habits.length ?? 0
  const atCap = !editingId && activeCount >= 6

  // The phase target is required when creating, or when editing a habit that
  // still has an active/ready phase to edit.
  const needsTarget = !editingId || !!editingPhaseId

  const breaking = form.kind === 'break'
  const taper = breaking && form.breakMode === 'taper'

  // A build cue is submittable when its type carries the matching specifics; a
  // break habit instead requires the trigger it's removing. (The Concreteness
  // score nudges toward sharper inputs beyond this minimum.)
  const cueValid = breaking
    ? !!form.avoidTrigger.trim()
    : (form.cueType === 'habit_stack' && !!form.anchorRoutine.trim()) ||
      (form.cueType === 'time' && !!form.cueTime.trim()) ||
      (form.cueType === 'location' && !!form.cueLocation.trim())

  const concreteness = scoreConcreteness({
    kind: form.kind,
    title: form.title,
    cueType: form.cueType,
    anchorRoutine: form.anchorRoutine,
    cueTime: form.cueTime,
    cueLocation: form.cueLocation,
    failSafeAction: form.failSafeAction,
    targetText: form.targetText,
    definitionOfDone: form.definitionOfDone,
    celebration: form.celebration,
    temptationBundle: form.temptationBundle,
    avoidTrigger: form.avoidTrigger,
    replacementAction: form.replacementAction,
    frictionDevice: form.frictionDevice,
    needsTarget,
  })

  // Every extra ladder step must be complete before the habit can be engineered.
  const extraPhasesValid = extraPhases.every((p) => p.targetText.trim() && p.targetCount > 0)

  const valid =
    form.title.trim() && cueValid && fs &&
    (!needsTarget || (form.targetText.trim() && form.targetCount > 0)) &&
    extraPhasesValid && (scheduleType === 'weekly' || days.length > 0) && confirmedQuick && !atCap

  const busy = create.isPending || update.isPending

  // Kind-aware copy — the same form sections, relabelled for the inverted laws.
  const copy = breaking
    ? {
        heading: 'Engineer your escape',
        subtitle: 'Design the bad habit out — make it invisible, unattractive, difficult, and unsatisfying.',
        identityPlaceholder: 'I am someone who is free of late-night scrolling',
        intentionTitle: 'Remove the trigger, plan the swap',
        cuePrompt: 'When does the urge usually strike?',
        attractiveLabel: 'Make it unattractive — the real cost of this habit',
        attractivePlaceholder: 'steals the calm sleep I actually want',
        celebrationLabel: 'Make it unsatisfying — who I’ll be accountable to (optional)',
        celebrationPlaceholder: 'text my partner that I caved',
        phaseTitle: 'Clean-day milestones',
        nightstandLabel: 'Environment redesign — what I’ll remove tonight (optional)',
        nightstandPlaceholder: 'Phone charges in the kitchen, not the bedroom',
        submit: 'Engineer my escape',
        habitHeader: 'The habit you’re breaking',
        habitLabel: 'Habit you’re breaking (as an identity)',
        goalLabel: 'Identity / goal that breaking this supports',
        whyLabel: 'Your why',
        whyPlaceholder: 'Why break this? What life are you voting for by quitting?',
        systemFocusExplainer: 'Quitting is the goal; the daily system — invisible, difficult, unsatisfying — is what actually gets you free.',
      }
    : {
        heading: 'Engineer a habit',
        subtitle: 'Turn an emotional spark into a rigid behavioural rule. Ambiguity is the enemy.',
        identityPlaceholder: 'I am someone who moves every day',
        intentionTitle: 'Implementation intention',
        cuePrompt: 'What triggers it?',
        attractiveLabel: 'Make it attractive — only do this while… (optional)',
        attractivePlaceholder: 'listening to my favourite podcast, with my good coffee',
        celebrationLabel: 'Then I’ll celebrate by… (optional)',
        celebrationPlaceholder: 'say “that’s like me”, fist-pump, tick the box',
        phaseTitle: 'Just-in-time phase mapper',
        nightstandLabel: 'Nightstand check (optional) — tomorrow’s environment prep',
        nightstandPlaceholder: 'Weighted pack sitting on the treadmill belt',
        submit: 'Engineer habit',
        habitHeader: 'The habit',
        habitLabel: 'Habit (as an identity)',
        goalLabel: 'Identity / goal this habit supports',
        whyLabel: 'Your why',
        whyPlaceholder: 'Why does this matter? What life are you voting for?',
        systemFocusExplainer: 'The goal sets the direction; the daily system is what actually gets you there.',
      }

  function submit() {
    if (!valid) return
    if (editingId) {
      update.mutate()
      return
    }
    create.mutate({
      kind: form.kind,
      goalId: form.goalId || null,
      breakMode: breaking ? form.breakMode : null,
      checkStyle: taper ? 'hold' : form.checkStyle,
      checkQuestion: form.checkStyle === 'yesno' && !taper ? form.checkQuestion.trim() || null : null,
      avoidTrigger: breaking ? form.avoidTrigger.trim() || null : null,
      replacementAction: breaking ? form.replacementAction.trim() || null : null,
      frictionDevice: breaking ? form.frictionDevice.trim() || null : null,
      title: form.title.trim(),
      whyText: form.whyText.trim() || null,
      whyImageUrl: form.whyImageUrl.trim() || null,
      cueType: form.cueType,
      anchorRoutine: form.cueType === 'habit_stack' ? form.anchorRoutine.trim() : null,
      cueTime: form.cueType === 'time' ? form.cueTime.trim() : null,
      cueLocation: form.cueType === 'location' ? form.cueLocation.trim() : null,
      failSafeAction: form.failSafeAction.trim(),
      celebration: form.celebration.trim() || null,
      temptationBundle: form.temptationBundle.trim() || null,
      ...schedulePayload(),
      ...reminderPayload(),
      nightstandRule: form.nightstandRule.trim() || null,
      setbackPlans: cleanSetbacks(setbacks),
      systemFocusConfirmed: form.systemFocusConfirmed,
      sectionNotes: cleanNotes(sectionNotes),
      phases: [
        {
          targetText: form.targetText.trim(),
          definitionOfDone: form.definitionOfDone.trim() || null,
          targetCount: Number(form.targetCount),
          dailyLimit: taper ? Number(form.dailyLimit) : null,
        },
        ...extraPhases.map((p) => ({
          targetText: p.targetText.trim(),
          definitionOfDone: p.definitionOfDone.trim() || null,
          targetCount: Number(p.targetCount),
          dailyLimit: taper ? Number(p.dailyLimit) : null,
        })),
      ],
    })
  }

  return (
    <div className="animate-fade-in">
      <header className="mb-6">
        <Link
          to="/app"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1"
        >
          <ArrowLeft size={15} /> Back to Launchpad
        </Link>
        <div className="flex items-center gap-2 text-text-3">
          <Hammer size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">The Architect</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          {editingId ? 'Edit habit' : copy.heading}
        </h1>
        <p className="mt-1 text-sm text-text-2">
          {editingId
            ? 'Refine the blueprint. Changes apply to your current phase.'
            : copy.subtitle}
        </p>
      </header>

      <div className="space-y-5">
        {/* Build vs Break — the discriminator that inverts the Four Laws.
            Locked once a habit exists (you don't convert one into the other). */}
        {!editingId && (
          <section className="rounded-2xl border border-border bg-surface p-2 shadow-card">
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'build' as HabitKind, label: 'Build a habit', sub: 'Grow a good one', icon: Sprout },
                { value: 'break' as HabitKind, label: 'Break a habit', sub: 'Quit a bad one', icon: Ban },
              ]).map((k) => {
                const active = form.kind === k.value
                return (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => set('kind', k.value)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl px-4 py-3 text-left transition-colors',
                      active ? 'bg-accent text-white' : 'bg-surface-2 text-text-2 hover:text-text-1'
                    )}
                  >
                    <k.icon size={18} className="shrink-0" />
                    <span>
                      <span className="block text-sm font-semibold">{k.label}</span>
                      <span className={cn('block text-xs', active ? 'text-white/80' : 'text-text-3')}>{k.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {breaking && (
              <div className="mt-2 flex flex-wrap gap-2 border-t border-border px-2 pb-1 pt-3">
                <span className="self-center text-xs font-medium text-text-2">How will you beat it?</span>
                {([
                  { value: 'abstain' as BreakMode, label: 'Quit entirely' },
                  { value: 'taper' as BreakMode, label: 'Taper down' },
                ]).map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => set('breakMode', m.value)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      form.breakMode === m.value
                        ? 'border-accent bg-accent text-white'
                        : 'border-border bg-surface-2 text-text-2 hover:text-text-1'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Blueprint interview — a short co-design conversation that drafts the
            whole thing in the user's own words (create mode only). The Compass
            hands its rough habit sentence in as the opening answer. */}
        {!editingId && (
          <BlueprintInterview
            kind={form.kind}
            wsId={wsId}
            goalId={form.goalId || null}
            initialText={atomizerSeed}
            onApply={applyBlueprint}
          />
        )}

        {/* ── The habit + the identity it serves (worksheet header) ─────────
            "Habit → Identity that this habit supports → focus on a system,
            not a goal." Lifted above the four laws so the whole worksheet
            hangs off it. */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-3 flex items-center gap-2 text-text-2">
            <Pin size={14} />
            <h2 className="text-xs font-semibold uppercase tracking-widest">{copy.habitHeader}</h2>
          </div>

          <Input
            label={copy.habitLabel}
            placeholder={copy.identityPlaceholder}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />

          {/* The ABZ chain: every habit is B — the first step toward a Z. */}
          <div className="mt-3">
            {activeGoals.length > 0 ? (
              <>
                <label className="mb-1 block text-xs font-medium text-text-2">
                  {copy.goalLabel}
                </label>
                <select
                  value={form.goalId}
                  onChange={(e) => set('goalId', e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-1 focus:border-accent focus:outline-none"
                >
                  <option value="">No goal (just a good habit)</option>
                  {activeGoals.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
                {!form.goalId && (
                  <p className="mt-1.5 text-xs text-text-3">
                    Habits stick better when they serve something bigger — consider linking this to a goal.
                  </p>
                )}
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-3 text-xs text-text-3">
                No goals yet. The <Link to="/app/compass" className="font-medium text-accent hover:underline">Compass</Link> helps
                you name where you're heading, so every habit serves something bigger.
              </p>
            )}
          </div>

          <div className="mt-3">
            <Textarea
              label={copy.whyLabel}
              placeholder={copy.whyPlaceholder}
              rows={3}
              value={form.whyText}
              onChange={(e) => set('whyText', e.target.value)}
            />
          </div>
          <div className="mt-3">
            <Input
              label="Why image URL (optional)"
              placeholder="https://…"
              value={form.whyImageUrl}
              onChange={(e) => set('whyImageUrl', e.target.value)}
            />
          </div>
          {form.whyImageUrl.trim() && (
            <img
              src={form.whyImageUrl}
              alt="Why"
              className="mt-3 h-32 w-full rounded-xl object-cover"
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          )}

          {/* Workbook's "focusing on a system, not a goal" confirmation — a
              nudge the user acknowledges, never a save gate. */}
          <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-border pt-4 text-sm text-text-2">
            <input
              type="checkbox"
              checked={form.systemFocusConfirmed}
              onChange={(e) => set('systemFocusConfirmed', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-accent))]"
            />
            <span>
              I’m focusing on a <span className="font-medium text-text-1">system, not a goal</span>.
              <span className="block text-xs text-text-3">
                {copy.systemFocusExplainer}
              </span>
            </span>
          </label>
        </section>

        {/* ── The system: the four laws ─────────────────────────────────────*/}
        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-2">The system</span>
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-text-3">Cue → Craving → Response → Reward</span>
        </div>

        {/* ── 1 · CUE ──────────────────────────────────────────────────────
            The trigger: implementation intention, schedule, and the
            environment that makes the cue unmissable (or invisible). */}
        <LoopStage
          step={1}
          title="Cue"
          law={breaking ? 'Make it invisible' : 'Make it obvious'}
          blurb={breaking
            ? 'Remove the trigger and redesign the moments where the urge usually strikes.'
            : 'Pin the exact trigger — a time, a place, or an existing routine — so the habit has a starting gun.'}
        >
          {/* Strict template */}
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">
              {copy.intentionTitle}
            </h2>

            {/* Make it invisible — the cue to remove (break only) */}
            {breaking && (
              <div className="mb-4 flex items-start gap-2">
                <EyeOff size={16} className="mt-7 shrink-0 text-accent" />
                <div className="flex-1">
                  <Input
                    label="The trigger to remove — make it invisible"
                    placeholder="My phone within reach in bed"
                    value={form.avoidTrigger}
                    onChange={(e) => set('avoidTrigger', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Cue type — force a concrete trigger category */}
            <p className="mb-2 text-xs font-medium text-text-2">{copy.cuePrompt}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {CUE_TYPES.map((c) => {
                const active = form.cueType === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => set('cueType', c.value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'border-accent bg-accent text-white'
                        : 'border-border bg-surface-2 text-text-2 hover:text-text-1'
                    )}
                  >
                    <c.icon size={14} />
                    {c.label}
                  </button>
                )
              })}
            </div>

            <div className="font-serif text-lg leading-relaxed text-text-1">
              {form.cueType === 'habit_stack' && (
                <>
                  After I{' '}
                  <GrowInput
                    placeholder="existing reliable routine"
                    value={form.anchorRoutine}
                    onChange={(v) => set('anchorRoutine', v)}
                  />
                </>
              )}
              {form.cueType === 'time' && (
                <>
                  At{' '}
                  <input
                    type="time"
                    className="mx-1 inline-block border-b-2 border-accent bg-transparent px-1 font-sans text-base focus:outline-none"
                    value={form.cueTime}
                    onChange={(e) => set('cueTime', e.target.value)}
                  />
                </>
              )}
              {form.cueType === 'location' && (
                <>
                  When I get to{' '}
                  <GrowInput
                    placeholder="a specific place"
                    value={form.cueLocation}
                    onChange={(v) => set('cueLocation', v)}
                  />
                </>
              )}
              {breaking ? ', I will instead ' : ', I will immediately '}
              <GrowInput
                placeholder={breaking ? 'a better thing to do' : '2-minute gateway'}
                value={breaking ? form.replacementAction : form.failSafeAction}
                onChange={(v) => set(breaking ? 'replacementAction' : 'failSafeAction', v)}
              />
              .
            </div>
            <p className="mt-2 text-xs text-text-3">
              {breaking
                ? 'When the urge hits, run the replacement instead of reaching for the habit.'
                : 'The gateway must take under two minutes. This is your permanent fail-safe — it never scales.'}
            </p>
            {!breaking && failSafeTooLong && (
              <p className="mt-3 text-xs text-amber">
                That gateway looks too big. Shrink it to one tiny action you could do in under two
                minutes (e.g. “put on my running shoes”, not a whole workout).
              </p>
            )}
          </section>

          {/* Schedule + nightstand */}
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">
              Schedule &amp; environment
            </h2>
            <p className="mb-2 text-xs font-medium text-text-2">How often</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {([
                { value: 'days' as ScheduleType, label: 'Specific days' },
                { value: 'weekly' as ScheduleType, label: 'Times per week' },
              ]).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setScheduleType(m.value)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    scheduleType === m.value
                      ? 'bg-accent text-white'
                      : 'bg-surface-2 text-text-3 hover:text-text-1'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {scheduleType === 'days' ? (
              <div className="flex gap-2">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={cn(
                      'h-9 w-9 rounded-full text-sm font-medium transition-colors',
                      days.includes(i)
                        ? 'bg-accent text-white'
                        : 'bg-surface-2 text-text-3 hover:text-text-1'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => setTimesPerWeek(n)}
                      className={cn(
                        'h-9 w-9 rounded-full text-sm font-medium transition-colors',
                        timesPerWeek === n
                          ? 'bg-accent text-white'
                          : 'bg-surface-2 text-text-3 hover:text-text-1'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-3">
                  {timesPerWeek}× a week, any days. Nothing counts as a miss while you can
                  still get there — the pressure only shows up once the week runs short.
                </p>
              </div>
            )}
            {/* Check-in style — hold-to-vote, or a yes-or-no question card.
                Taper habits always use their count control, so no choice there. */}
            {!taper && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-xs font-medium text-text-2">How you’ll check in each day</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([
                    { value: 'hold' as CheckStyle, label: 'Hold to log' },
                    { value: 'yesno' as CheckStyle, label: 'Yes-or-no question' },
                  ]).map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => set('checkStyle', s.value)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition-colors',
                        form.checkStyle === s.value
                          ? 'border-accent bg-accent text-white'
                          : 'border-border bg-surface-2 text-text-2 hover:text-text-1'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {form.checkStyle === 'yesno' && (
                  <div className="mt-3">
                    <Input
                      label="The question your card will ask"
                      placeholder="Did I sleep 8 hours last night?"
                      value={form.checkQuestion}
                      onChange={(e) => set('checkQuestion', e.target.value)}
                    />
                    <p className="mt-1.5 text-xs text-text-3">
                      Answering no asks what got in the way — that’s the useful data. Leave blank to use your phase target.
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* Reminder — the moment-of-choice nudge, on every channel the user opts into */}
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-text-2">Reminder</p>
                  <p className="mt-0.5 text-xs text-text-3">A nudge at the moment you decided to act.</p>
                </div>
                <button
                  type="button"
                  onClick={() => set('reminderEnabled', !form.reminderEnabled)}
                  role="switch"
                  aria-checked={form.reminderEnabled}
                  aria-label="Toggle reminder"
                  className={cn(
                    'relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors',
                    form.reminderEnabled ? 'bg-accent' : 'bg-surface-2'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow transition-all',
                      form.reminderEnabled ? 'left-[20px]' : 'left-[2px]'
                    )}
                  />
                </button>
              </div>
              {form.reminderEnabled && (
                <div className="mt-3 flex items-center gap-3">
                  <Clock size={16} className="shrink-0 text-text-3" />
                  <input
                    type="time"
                    value={form.reminderTime || (form.cueType === 'time' ? form.cueTime : '')}
                    onChange={(e) => set('reminderTime', e.target.value)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-1 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
                  />
                  <span className="text-xs text-text-3">
                    {form.cueType === 'time' && !form.reminderTime.trim()
                      ? 'Defaults to your cue time'
                      : 'Local time, on scheduled days'}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4">
              <Input
                label={copy.nightstandLabel}
                placeholder={copy.nightstandPlaceholder}
                value={form.nightstandRule}
                onChange={(e) => set('nightstandRule', e.target.value)}
              />
            </div>
          </section>
          <SectionNotes value={sectionNotes.cue} onChange={(v) => setNote('cue', v)} suggestions={SECTION_SUGGESTIONS.cue[breaking ? 'break' : 'build']} />
        </LoopStage>

        {/* ── 2 · CRAVING ──────────────────────────────────────────────────
            The motivation: the temptation bundle (or named cost) that makes
            the habit something you look forward to — or repulsive. Identity +
            why live in the header block above. */}
        <LoopStage
          step={2}
          title="Craving"
          law={breaking ? 'Make it unattractive' : 'Make it attractive'}
          blurb={breaking
            ? 'Name the real cost so the habit loses its shine.'
            : 'Bundle the habit with something you genuinely want, so you crave the doing.'}
        >
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="shrink-0 text-accent" />
              <div className="flex-1">
                <Input
                  label={copy.attractiveLabel}
                  placeholder={copy.attractivePlaceholder}
                  value={form.temptationBundle}
                  onChange={(e) => set('temptationBundle', e.target.value)}
                />
              </div>
            </div>
          </section>
          <SectionNotes value={sectionNotes.craving} onChange={(v) => setNote('craving', v)} suggestions={SECTION_SUGGESTIONS.craving[breaking ? 'break' : 'build']} />
        </LoopStage>

        {/* ── 3 · RESPONSE ─────────────────────────────────────────────────
            The action itself: keep it tiny (or add friction), map the phase
            ladder, and plan for the days it goes sideways. */}
        <LoopStage
          step={3}
          title="Response"
          law={breaking ? 'Make it difficult' : 'Make it easy'}
          blurb={breaking
            ? 'Add friction between you and the habit, define what a clean day looks like, and plan the comeback.'
            : 'Start with a two-minute version, climb the phase ladder, and plan for setbacks before they happen.'}
        >
          {/* The 2-minute resist + friction device (break only) */}
          {breaking && (
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">
                When the urge wins ground
              </h2>
              <div className="flex items-start gap-2">
                <Shield size={16} className="mt-7 shrink-0 text-accent" />
                <div className="flex-1">
                  <Input
                    label="If the urge is strong — my 2-minute resist"
                    placeholder="Put the phone face-down and take 3 breaths"
                    value={form.failSafeAction}
                    onChange={(e) => set('failSafeAction', e.target.value)}
                  />
                </div>
              </div>
              {failSafeTooLong && (
                <p className="mt-3 text-xs text-amber">
                  That resist looks too big. Shrink it to one tiny action you could do in under two
                  minutes (e.g. “phone face-down, 3 breaths”, not a whole ritual).
                </p>
              )}
              <div className="mt-4 flex items-start gap-2">
                <ShieldOff size={16} className="mt-7 shrink-0 text-accent" />
                <div className="flex-1">
                  <Input
                    label="Make it difficult — my friction or commitment device"
                    placeholder="Phone charges in the kitchen overnight"
                    value={form.frictionDevice}
                    onChange={(e) => set('frictionDevice', e.target.value)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Phase Mapper */}
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-text-2">
            {copy.phaseTitle}
          </h2>

          {/* Permanent fail-safe / 2-minute resist */}
          <div className="mb-3 flex items-start gap-3 rounded-xl border border-border bg-bg p-3">
            <Shield size={16} className="mt-0.5 text-success" />
            <div>
              <p className="text-sm font-medium text-text-1">{breaking ? '2-minute resist' : 'Permanent fail-safe'}</p>
              <p className="text-sm text-text-2">
                {form.failSafeAction.trim() || <span className="text-text-3">Set the 2-minute {breaking ? 'resist' : 'gateway'} above</span>}
              </p>
            </div>
          </div>

          <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-text-2">
            <input
              type="checkbox"
              checked={confirmedQuick}
              onChange={(e) => setConfirmedQuick(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-accent))]"
            />
            {breaking
              ? 'I can do this 2-minute resist whenever the urge hits.'
              : 'I can do this fail-safe in under two minutes.'}
          </label>

          {/* Active phase target */}
          <div className="rounded-xl border border-accent/30 bg-bg p-4">
            <div className="mb-3 flex items-center gap-2">
              <Target size={16} className="text-accent" />
              <p className="text-sm font-semibold text-text-1">
                {editingId ? 'Current milestone' : breaking ? 'Phase 1 — first milestone' : 'Phase 1 — the automaticity target'}
              </p>
            </div>
            {editingId && !editingPhaseId ? (
              <p className="text-sm text-text-3">
                This habit’s current phase has graduated. Define the next {breaking ? 'milestone' : 'target'} from its card on the
                Launchpad.
              </p>
            ) : (
              <>
                <Input
                  label={breaking ? (taper ? 'Daily cap (in words)' : 'Milestone') : 'Daily target'}
                  placeholder={breaking ? (taper ? '≤2 a day' : 'Stay scroll-free 14 days') : 'Walk 15 mins on the treadmill'}
                  value={form.targetText}
                  onChange={(e) => set('targetText', e.target.value)}
                />
                {taper && (
                  <div className="mt-3 max-w-[260px]">
                    <Input
                      label="Daily limit — max allowed per day"
                      type="number"
                      min={0}
                      value={form.dailyLimit}
                      onChange={(e) => set('dailyLimit', Number(e.target.value))}
                    />
                  </div>
                )}
                <div className="mt-3 flex items-start gap-2">
                  <Flag size={16} className="mt-7 shrink-0 text-text-3" />
                  <div className="flex-1">
                    <Input
                      label={breaking ? 'What counts as a clean day' : 'Definition of done — the exact finish line'}
                      placeholder={breaking ? 'No scrolling in bed after 10pm' : 'Both shoes on and standing on the treadmill belt'}
                      value={form.definitionOfDone}
                      onChange={(e) => set('definitionOfDone', e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-3 max-w-[260px]">
                  <Input
                    label={breaking ? 'Clean days before the Automaticity Check' : 'Reps before the Automaticity Check'}
                    type="number"
                    min={1}
                    value={form.targetCount}
                    onChange={(e) => set('targetCount', Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          {/* The phase ladder — pre-map the staircase. In edit mode these are the
              habit's upcoming (locked) steps; you can edit, add, or remove them. */}
          {needsTarget && (
            <div className="mt-3 space-y-3">
              {extraPhases.map((p, i) => (
                <div key={p.id ?? `new-${i}`} className="rounded-xl border border-border bg-bg p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-text-1">
                      <Lock size={13} className="text-text-3" /> {editingId ? `Upcoming milestone ${i + 1}` : `Phase ${i + 2}`} — locked
                    </p>
                    <button
                      type="button"
                      onClick={() => removePhase(i)}
                      className="text-text-3 hover:text-danger"
                      aria-label={`Remove phase ${i + 2}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <Input
                    label={breaking ? (taper ? 'Daily cap (in words)' : 'Milestone') : 'Daily target'}
                    placeholder={breaking ? (taper ? '≤1 a day' : 'Stay scroll-free 30 days') : 'Walk 25 mins on the treadmill'}
                    value={p.targetText}
                    onChange={(e) => setPhase(i, 'targetText', e.target.value)}
                  />
                  {taper && (
                    <div className="mt-2 max-w-[260px]">
                      <Input
                        label="Daily limit"
                        type="number"
                        min={0}
                        value={p.dailyLimit}
                        onChange={(e) => setPhase(i, 'dailyLimit', Number(e.target.value))}
                      />
                    </div>
                  )}
                  <div className="mt-2">
                    <Input
                      label={breaking ? 'What counts as a clean day' : 'Definition of done'}
                      placeholder={breaking ? 'No scrolling after 10pm' : '25 mins logged on the console'}
                      value={p.definitionOfDone}
                      onChange={(e) => setPhase(i, 'definitionOfDone', e.target.value)}
                    />
                  </div>
                  <div className="mt-2 max-w-[260px]">
                    <Input
                      label={breaking ? 'Clean days before its Automaticity Check' : 'Reps before its Automaticity Check'}
                      type="number"
                      min={1}
                      value={p.targetCount}
                      onChange={(e) => setPhase(i, 'targetCount', Number(e.target.value))}
                    />
                  </div>
                </div>
              ))}

              {extraPhases.length < 5 ? (
                <button
                  type="button"
                  onClick={addPhase}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-text-2 hover:border-accent hover:text-text-1"
                >
                  <Plus size={15} /> Add the next step
                </button>
              ) : (
                <p className="text-center text-xs text-text-3">
                  {editingId ? 'That’s five upcoming steps mapped — plenty of runway.' : 'That’s a full staircase — six phases is the max.'}
                </p>
              )}

              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-text-3">
                <Lock size={15} className="shrink-0" />
                <p className="text-xs">
                  Each step unlocks automatically when the one before it passes its Automaticity Check.
                  Start tiny — the climb takes care of itself.
                </p>
              </div>
            </div>
          )}
        </section>
          <SectionNotes value={sectionNotes.response} onChange={(v) => setNote('response', v)} suggestions={SECTION_SUGGESTIONS.response[breaking ? 'break' : 'build']} />
        </LoopStage>

        {/* ── 4 · REWARD ───────────────────────────────────────────────────
            Close the loop: an immediate payoff (or an immediate cost) so the
            brain files this rep as worth repeating (or not). */}
        <LoopStage
          step={4}
          title="Reward"
          law={breaking ? 'Make it unsatisfying' : 'Make it satisfying'}
          blurb={breaking
            ? 'Give a slip an immediate cost — accountability makes caving expensive.'
            : 'End every rep with an immediate payoff, however small — what gets rewarded gets repeated.'}
        >
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center gap-2">
              <PartyPopper size={16} className="shrink-0 text-accent" />
              <div className="flex-1">
                <Input
                  label={copy.celebrationLabel}
                  placeholder={copy.celebrationPlaceholder}
                  value={form.celebration}
                  onChange={(e) => set('celebration', e.target.value)}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-text-3">
              {breaking
                ? 'Also: every clean day you log casts a visible vote — the streak itself becomes the reward.'
                : 'Your vote on the Launchpad is the built-in reward — this celebration seals it in the moment.'}
            </p>
          </section>
          <SectionNotes value={sectionNotes.reward} onChange={(v) => setNote('reward', v)} suggestions={SECTION_SUGGESTIONS.reward[breaking ? 'break' : 'build']} />
        </LoopStage>

        {/* ── Prepare for setbacks (worksheet's closing section) ────────────
            The workbook's "Potential Obstacles / Plans to Overcome Them" —
            if/then pairs that resurface on the card after a missed day. */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-text-2">
            Prepare for setbacks
          </h2>
          <p className="mb-4 text-xs text-text-3">
            Never expect to fail, but always plan for it. When you miss a day, your plan shows up right on the card.
          </p>
          <div className="space-y-3">
            {setbacks.map((row, i) => (
              <div key={i} className="rounded-xl border border-border bg-bg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 font-serif text-base leading-relaxed text-text-1">
                    If{' '}
                    <GrowInput
                      placeholder="the day gets away from me"
                      value={row.obstacle}
                      onChange={(v) => setSetbacks((rows) => rows.map((r, idx) => idx === i ? { ...r, obstacle: v } : r))}
                    />
                    , then I will{' '}
                    <GrowInput
                      placeholder="do the 2-minute version before bed"
                      value={row.plan}
                      onChange={(v) => setSetbacks((rows) => rows.map((r, idx) => idx === i ? { ...r, plan: v } : r))}
                    />
                    .
                  </div>
                  <button
                    type="button"
                    onClick={() => setSetbacks((rows) => rows.filter((_, idx) => idx !== i))}
                    className="mt-1 text-text-3 hover:text-danger"
                    aria-label={`Remove setback plan ${i + 1}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {setbacks.length < 3 && (
              <button
                type="button"
                onClick={() => setSetbacks((rows) => [...rows, { obstacle: '', plan: '' }])}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-text-2 hover:border-accent hover:text-text-1"
              >
                <Plus size={15} /> {setbacks.length === 0 ? 'Add an if–then plan' : 'Add another plan'}
              </button>
            )}
          </div>
          <div className="mt-3">
            <SectionNotes value={sectionNotes.setbacks} onChange={(v) => setNote('setbacks', v)} suggestions={SECTION_SUGGESTIONS.setbacks[breaking ? 'break' : 'build']} bare />
          </div>
        </section>

        <SharpenHints checks={concreteness.checks} />

        {atCap && (
          <div className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-text-1">
            You’re already running 6 habits — that’s the ceiling, and one at a time sticks best. Pause or archive one before engineering another.
          </div>
        )}

        {/* On mobile this action row sticks just above the fixed bottom nav so
            Save is always one thumb-reach away on the long form. */}
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex items-center gap-3 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button variant="primary" size="lg" disabled={!valid} loading={busy} onClick={submit}>
            {editingId ? 'Save changes' : copy.submit}
          </Button>
          <Link to="/app" className="-my-2 py-2 text-sm text-text-2 hover:text-text-1">Cancel</Link>
          {editingId && (
            <button
              onClick={() => togglePause.mutate()}
              disabled={togglePause.isPending}
              className="-my-2 ml-auto inline-flex items-center gap-1.5 py-2 text-sm text-text-3 hover:text-text-1 disabled:opacity-50"
            >
              {isPaused ? <><PlayCircle size={15} /> Resume habit</> : <><PauseCircle size={15} /> Pause habit</>}
            </button>
          )}
          {editingId && (
            <button
              onClick={() => remove.mutate(editingId)}
              className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm text-text-3 hover:text-danger"
            >
              <Trash2 size={15} /> Delete habit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// One stage of the habit loop (cue → craving → response → reward). Groups the
// form cards under a numbered header naming the law it serves — inverted
// automatically for break habits by the caller.
function LoopStage({ step, title, law, blurb, children }: {
  step: number
  title: string
  law: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={`${step} · ${title}`}>
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-sm font-bold text-accent">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-text-1">
            {title}
            <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-text-2">
              {law}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-text-3">{blurb}</p>
        </div>
      </div>
      <div className="space-y-4 border-l-2 border-border pl-4 sm:ml-4 sm:pl-6">
        {children}
      </div>
    </section>
  )
}

// Per-section free-text — the user's own tactics beyond the structured blocks,
// with a quiet menu of the workbook's other ideas for this law as a starting
// point. `bare` drops the card chrome when nested inside another section.
function SectionNotes({ value, onChange, suggestions, bare }: {
  value?: string
  onChange: (v: string) => void
  suggestions: string[]
  bare?: boolean
}) {
  const body = (
    <>
      <Textarea
        label="Your own notes (optional)"
        rows={2}
        placeholder="Anything else you’ll try here — in your own words."
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {suggestions.length > 0 && (
        <p className="mt-1.5 text-[11px] text-text-3">
          Other ways: {suggestions.join(' · ')}
        </p>
      )}
    </>
  )
  if (bare) return body
  return (
    <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-4">
      {body}
    </section>
  )
}

// Gentle sharpening hints — the science guardrails as quiet suggestions, not a
// gamified score. Only surfaces the checks that are still fuzzy; disappears once
// the habit is concrete, so it never nags a finished blueprint.
function SharpenHints({ checks }: { checks: { key: string; label: string; hint: string; passed: boolean }[] }) {
  const failing = checks.filter((c) => !c.passed)
  if (failing.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-text-2">
        <Sprout size={15} />
        <h2 className="text-xs font-semibold uppercase tracking-widest">A few ways to sharpen it</h2>
      </div>
      <ul className="space-y-2.5">
        {failing.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/50" />
            <span className="text-text-2">
              <span className="font-medium text-text-1">{c.label}.</span> {c.hint}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-text-3">These are nudges, not gates — you can save whenever you’re ready.</p>
    </section>
  )
}

// An inline text field that grows with its content instead of cropping. A hidden
// mirror span (same font/padding as the input) drives the width via CSS grid, so
// the underline stretches to fit the text and wraps to a new line when it hits
// the container edge. No JS measuring — works across browsers.
function GrowInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <span className="mx-1 inline-grid max-w-full align-baseline">
      {/* Mirror and input MUST render at the same font-size or the width is off.
          A global rule pins inputs to 16px (iOS-zoom guard) while this theme's
          text-base is 15px — so both are pinned to 16px here to stay in step. */}
      <span className="invisible col-start-1 row-start-1 whitespace-pre px-1 font-sans text-[16px]" aria-hidden>
        {value || placeholder || ''}
      </span>
      <input
        size={1}
        className="col-start-1 row-start-1 w-full min-w-[4rem] max-w-full border-b-2 border-accent bg-transparent px-1 font-sans text-[16px] focus:outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  )
}
