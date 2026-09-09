import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { format } from 'date-fns'
import { Check, Target, Sparkles, Pencil, Zap, Shield, ShieldOff, Minus, Plus, PauseCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { HabitToday, Goldilocks, SetbackPlan } from '@/types'
import { habits as habitsApi } from '@/lib/api'
import { triggerConfetti, cn, getHabitColor, type HabitColor } from '@/lib/utils'
import { mergeReasonChips } from '@/lib/missReasons'
import { AutomaticityCheckModal } from './AutomaticityCheckModal'
import { NextPhaseModal } from './NextPhaseModal'
import { MissReasonSheet } from './MissReasonSheet'
import { EditDaySheet } from './EditDaySheet'
import { WeekStrip } from './WeekStrip'

const GOLDILOCKS: { value: Goldilocks; label: string }[] = [
  { value: 'too_easy', label: 'Too Easy' },
  { value: 'just_right', label: 'Just Right' },
  { value: 'too_hard', label: 'Too Hard' },
]

const HOLD_MS = 1300

// Break habits get a distinct cool slate/indigo accent so the board reads at a
// glance — building (warm palette) vs leaving behind (cool).
const BREAK_COLOR: HabitColor = { border: '#5C6BC0', bg: '#5C6BC00F', text: '#5C6BC0', name: 'slate' } as unknown as HabitColor

// The vote tally — a tangible row of ticks, one per rep toward graduation.
function Tally({ filled, total, color }: { filled: number; total: number; color?: string }) {
  return (
    <div className="mb-2 flex gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn('h-[5px] flex-1 rounded-full', i >= filled && 'bg-[#E2DED6]')}
          style={i < filled ? { backgroundColor: color ?? '#B8714C' } : undefined}
        />
      ))}
    </div>
  )
}

export function HabitCard({ habit, wsId, weekday }: { habit: HabitToday; wsId: string; weekday?: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [failSafe, setFailSafe] = useState(false)
  const [showGoldilocks, setShowGoldilocks] = useState(false)
  const [showCheck, setShowCheck] = useState(false)
  const [showNextPhase, setShowNextPhase] = useState(false)
  // "What got in the way?" sheet — holds the date being explained (today, or
  // yesterday for the never-miss-twice catch-up), null when closed.
  const [reasonDate, setReasonDate] = useState<string | null>(null)
  // The past day being corrected from the WeekStrip, null when closed.
  const [editDate, setEditDate] = useState<string | null>(null)
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const holdStartRef = useRef<number>(0)

  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const breaking = habit.kind === 'break'
  const taper = breaking && habit.breakMode === 'taper'
  const yesNo = !taper && habit.checkStyle === 'yesno'
  const [qty, setQty] = useState(0)
  const done = !!habit.todayLog && habit.todayLog.status !== 'miss'
  const relapsedToday = habit.todayLog?.status === 'miss'
  const votedFailSafe = habit.todayLog?.status === 'failsafe'
  const phase = habit.activePhase
  const target = phase?.targetText ?? 'Do the thing'
  const finishLine = phase?.definitionOfDone?.trim()
  const reps = habit.completedReps
  const goal = phase?.targetCount ?? 0
  const filled = Math.min(reps, goal)
  const checkDue = habit.automaticity?.eligible && habit.automaticity?.due

  // A weekly-quota habit reads the server's week progress; a fixed-day habit
  // still asks the weekday. Either way the card never resolves a schedule itself.
  const wp = habit.weekProgress ?? null
  const scheduleDays: number[] = habit.scheduleDays ? JSON.parse(habit.scheduleDays) : [0, 1, 2, 3, 4, 5, 6]
  const isRequiredToday = wp
    ? wp.obligatedToday
    : weekday !== undefined ? scheduleDays.includes(weekday) : true
  // A weekly habit with reps still to give is never "off" — it's open. Only a
  // finished quota greys the card out.
  const isGrayedOut = wp ? wp.remaining === 0 && !done : !isRequiredToday && !done
  const dangerState = isRequiredToday && !done && habit.wasPreviousMissed

  // Workbook "Prepare for Setbacks" plans — surfaced on never-miss-twice days.
  const setbackPlans: SetbackPlan[] = (() => {
    try { return habit.setbackPlans ? JSON.parse(habit.setbackPlans) : [] } catch { return [] }
  })()

  // Server-computed local date for today, from the query this card came from.
  const todayDate =
    qc.getQueryData<{ date: string }>(['today', wsId])?.date ??
    new Intl.DateTimeFormat('en-CA').format(new Date())
  const reasonChips = mergeReasonChips(habit.setbackPlans)
  const todayReasonsRecorded = (() => {
    try { return (JSON.parse(habit.todayLog?.missReasons ?? '[]') as string[]).length > 0 } catch { return false }
  })()

  const log = useMutation({
    mutationFn: (vars: { status?: 'target' | 'failsafe' | 'miss'; quantity?: number; goldilocks?: Goldilocks; date?: string }) =>
      habitsApi.log(wsId, habit.id, vars),
    onMutate: async (vars) => {
      // Only the plain clean-day / target / failsafe vote for TODAY updates
      // optimistically; relapses, taper counts, Goldilocks ratings and past-day
      // edits just refetch on success.
      if (vars.goldilocks || vars.quantity !== undefined || vars.status === 'miss') return
      if (vars.date && vars.date !== todayDate) return
      await qc.cancelQueries({ queryKey: ['today', wsId] })
      const prev = qc.getQueryData<{ date: string; weekday: number; habits: HabitToday[] }>(['today', wsId])
      qc.setQueryData<{ date: string; weekday: number; habits: HabitToday[] }>(['today', wsId], (old) =>
        old
          ? {
              ...old,
              habits: old.habits.map((h) =>
                h.id === habit.id
                  ? {
                      ...h,
                      todayLog: { id: '', habitId: h.id, phaseId: null, date: '', status: vars.status ?? 'target', quantity: null, goldilocks: null, missReasons: '[]', missNote: null, createdAt: '' },
                      completedReps: h.completedReps + 1,
                      // Keep the week strip's today-dot in sync with the vote.
                      weekStrip: h.weekStrip?.map((d, idx) =>
                        idx === h.weekStrip!.length - 1 ? { ...d, status: vars.status ?? 'target' } : d
                      ),
                    }
                  : h
              ),
            }
          : old
      )
      return { prev }
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['today', wsId], ctx.prev)
      toast.error(e?.message ?? 'Could not log that')
    },
    onSuccess: (res) => {
      if (res.ready) toast('This habit might be on autopilot — take the Automaticity Check.', { icon: '✨' })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
    },
  })

  const unlog = useMutation({
    mutationFn: (vars: { date?: string }) => habitsApi.unlog(wsId, habit.id, vars.date),
    onMutate: async (vars) => {
      // Past-day clears just refetch; only today's undo updates optimistically.
      if (vars.date && vars.date !== todayDate) return
      await qc.cancelQueries({ queryKey: ['today', wsId] })
      const prev = qc.getQueryData(['today', wsId])
      qc.setQueryData<{ date: string; weekday: number; habits: HabitToday[] }>(['today', wsId], (old) =>
        old
          ? {
              ...old,
              habits: old.habits.map((h) =>
                h.id === habit.id
                  ? {
                      ...h,
                      todayLog: null,
                      completedReps: Math.max(0, h.completedReps - 1),
                      weekStrip: h.weekStrip?.map((d, idx) =>
                        idx === h.weekStrip!.length - 1 ? { ...d, status: null } : d
                      ),
                    }
                  : h
              ),
            }
          : old
      )
      return { prev }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['today', wsId], ctx.prev)
      toast.error('Could not undo vote')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
    },
  })

  const logReason = useMutation({
    mutationFn: (vars: { date: string; reasons: string[]; note?: string | null }) =>
      habitsApi.logReason(wsId, habit.id, vars),
    onSuccess: () => {
      setReasonDate(null)
      toast('Noted. That’s useful data, not a verdict.', { icon: '📝' })
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save that'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      qc.invalidateQueries({ queryKey: ['checkin-current', wsId] })
    },
  })

  const pause = useMutation({
    mutationFn: () => habitsApi.setPaused(wsId, habit.id, true),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['today', wsId] })
      const prev = qc.getQueryData(['today', wsId])
      qc.setQueryData<{ date: string; weekday: number; habits: HabitToday[] }>(['today', wsId], (old) =>
        old
          ? {
              ...old,
              habits: old.habits.filter((h) => h.id !== habit.id),
            }
          : old
      )
      return { prev }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['today', wsId], ctx.prev)
      toast.error('Could not pause this habit')
    },
    onSuccess: () => {
      toast('Paused. Resume it from the Launchpad whenever you’re ready.', { icon: '⏸️' })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
    },
  })

  function complete() {
    if (done || log.isPending) return
    log.mutate({ status: failSafe ? 'failsafe' : 'target' })
    // A short haptic tick confirms the vote landed (supported on Android; iOS ignores).
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15)
    triggerConfetti()
    // Calibration is an occasional check-in, not per-rep admin: ask after a
    // fail-safe day (a signal the target may be too big) or every 7th rep.
    setShowGoldilocks(failSafe || (reps + 1) % 7 === 0)
  }

  function rate(goldilocks: Goldilocks) {
    log.mutate({ status: failSafe ? 'failsafe' : 'target', goldilocks })
    setShowGoldilocks(false)
  }

  // Break-habit actions: log an explicit relapse, or (taper) log today's count.
  function relapse() {
    if (log.isPending) return
    log.mutate({ status: 'miss' })
    toast('Relapse logged. Never miss twice — tomorrow’s clean day is the comeback.', { icon: '🌅' })
    setReasonDate(todayDate)
  }

  function logTaperCount() {
    if (log.isPending) return
    log.mutate({ quantity: qty })
    const limit = phase?.dailyLimit ?? 0
    if (qty <= limit) { triggerConfetti(); setShowGoldilocks((reps + 1) % 7 === 0) }
    else setReasonDate(todayDate)
  }

  // Yes/No style: an explicit, honest "not today" — then ask what got in the way.
  function sayNo() {
    if (log.isPending) return
    log.mutate({ status: 'miss' })
    setReasonDate(todayDate)
  }

  function startHold() {
    if (done || log.isPending) return
    holdStartRef.current = Date.now()
    setHolding(true)
    const tick = () => {
      const p = Math.min((Date.now() - holdStartRef.current) / HOLD_MS, 1)
      setHoldProgress(p)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    holdTimerRef.current = setTimeout(() => {
      setHolding(false)
      setHoldProgress(0)
      complete()
    }, HOLD_MS)
  }

  function cancelHold() {
    if (!holding) return
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setHolding(false)
    setHoldProgress(0)
  }

  const doneSubtitle = breaking
    ? (votedFailSafe
        ? 'You felt the urge and held — that resistance is the vote. Keep stacking the evidence.'
        : `${reps} clean ${reps === 1 ? 'day' : 'days'} voting for who you’re becoming. This is who you are now — keep it going.`)
    : (votedFailSafe
        ? 'Fail-safe still counts — showing up is the vote. Keep stacking the evidence.'
        : `${reps} ${reps === 1 ? 'vote' : 'votes'} toward who you’re becoming. This is who you are now — keep stacking the evidence.`)

  const habitColor = breaking ? BREAK_COLOR : getHabitColor(habit.id)

  // Automaticity Check CTA — the one door that graduates a `ready` milestone and
  // unlocks the next step. Surfaced in every today-state (pre-vote, voted,
  // relapsed) so casting today's vote never hides the path forward. Callers wrap
  // it to control spacing.
  const checkCTA = checkDue ? (
    <button
      onClick={() => setShowCheck(true)}
      className="flex w-full items-center gap-2 rounded-[12px] border border-[#F0DECF] bg-[#FBF4EE] px-3 py-2.5 text-left text-[13px] text-[#211F1B] hover:bg-[#F7ECE2]"
    >
      <Sparkles size={16} className="shrink-0 text-[#B8714C]" />
      <span>This milestone’s ready — <span className="font-semibold">take the Automaticity Check</span> to unlock your next step</span>
    </button>
  ) : null

  return (
    <div
      className={cn(
        "relative flex w-full flex-col overflow-hidden rounded-[20px] bg-white transition-opacity",
        isGrayedOut && "opacity-60"
      )}
      style={{ boxShadow: '0 1px 2px rgba(20,18,15,.04), 0 10px 30px rgba(20,18,15,.06)' }}
    >
      {/* Color accent bar */}
      <div className="h-[3px] w-full" style={{ backgroundColor: habitColor.border }} />
      {/* ── Header: identity + why (shared across all states) ── */}
      {dangerState && (
        <div className="bg-[#FCF8F7] border-b border-[#F5E6E3] px-[24px] py-[10px]">
          <div className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C84B31]">
            Never miss twice
          </div>
          {setbackPlans.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {setbackPlans.slice(0, 2).map((p, i) => (
                <p key={i} className="text-[12.5px] leading-[1.45] text-[#8A5347]">
                  <span className="font-semibold">Your plan:</span> If {p.obstacle.trim().replace(/\.$/, '')}, then {p.plan.trim().replace(/\.$/, '')}.
                </p>
              ))}
            </div>
          ) : (
            <button
              onClick={() => navigate(`/app/architect/${habit.id}`)}
              className="mx-auto mt-1 block text-[12px] text-[#8A5347] underline hover:text-[#C84B31]"
            >
              Make a plan for days like this
            </button>
          )}
          {/* Next-day catch-up: explain yesterday's silent miss while it's fresh. */}
          {habit.previousMissNeedsReason && habit.previousMissDate && (
            <button
              onClick={() => setReasonDate(habit.previousMissDate!)}
              className="mx-auto mt-1.5 block text-[12px] font-medium text-[#8A5347] underline hover:text-[#C84B31]"
            >
              What got in the way yesterday?
            </button>
          )}
        </div>
      )}
      <div className="px-[24px] pb-[20px] pt-[24px]">
        <div className="mb-4 flex items-start justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em]"
            style={{ color: breaking ? habitColor.text : '#A6A199' }}>
            {breaking && <Shield size={12} strokeWidth={2.2} />}
            {breaking ? 'Leaving behind' : 'I am becoming'}
          </span>
          <button
            onClick={() => navigate(`/app/architect/${habit.id}`)}
            aria-label="Edit habit"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#F0EDE7] text-[#9C988F] transition-colors hover:bg-[#E7E3DB] hover:text-[#6F6B62]"
          >
            <Pencil size={14} strokeWidth={1.7} />
          </button>
        </div>
        <h3
          className="font-serif font-normal leading-[1.3] tracking-[-0.01em] text-[#211F1B]"
          style={{ fontSize: 21, WebkitLineClamp: 3, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {habit.title}
        </h3>
        {/* The ABZ chain — what this habit is the first step toward. */}
        {habit.goal?.title && (
          <p className="mt-1 text-[12.5px] font-medium text-[#8A6B3F]">
            → {habit.goal.title}
          </p>
        )}
        <WeekStrip days={habit.weekStrip ?? []} accentColor={habitColor.border} onEditDay={setEditDate} />
        {/* Where a weekly quota stands. The strip alone can't say it: a faint dot
            on a flexible habit means "you had slack", not "you skipped". */}
        {wp && (
          <p
            className={cn(
              'mt-2 text-[12px] font-medium',
              wp.remaining > 0 && wp.obligatedToday ? 'text-[#C84B31]' : 'text-[#8C887F]'
            )}
          >
            {wp.remaining === 0
              ? `${wp.hits} of ${wp.quota} this week — done.`
              : wp.obligatedToday
                ? wp.daysLeft === 1
                  ? `${wp.hits} of ${wp.quota} — last day to make it ${wp.quota}.`
                  : `${wp.hits} of ${wp.quota} — ${wp.remaining} left, ${wp.daysLeft} days to do them in.`
                : `${wp.hits} of ${wp.quota} this week — ${wp.remaining} to go, ${wp.daysLeft} days left.`}
          </p>
        )}
        {/* The why moves into the vote moment once today's vote is cast. */}
        {habit.whyText && !done && (
          <div className="mt-4 border-l-2 border-[#E0B79F] pl-[14px]">
            <p
              className="font-serif italic leading-[1.5] text-[#6F6B62]"
              style={{ fontSize: 14, WebkitLineClamp: 4, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {habit.whyText}
            </p>
          </div>
        )}
        {(() => {
          const { cueType, anchorRoutine, cueTime, cueLocation, failSafeAction, replacementAction } = habit
          let cuePhrase: string | null = null
          if (cueType === 'habit_stack' && anchorRoutine) cuePhrase = breaking ? `When I ${anchorRoutine}` : `After I ${anchorRoutine}`
          else if (cueType === 'time' && cueTime) cuePhrase = breaking ? `Around ${cueTime}` : `At ${cueTime}`
          else if (cueType === 'location' && cueLocation) cuePhrase = breaking ? `At ${cueLocation}` : `When I get to ${cueLocation}`
          if (!cuePhrase) return null
          // Break habits pair the cue with the replacement swap (the real
          // behaviour). Build habits show the cue alone as the trigger — the
          // daily target lives under Today's vote, and the do-minimum fail-safe
          // only surfaces there when it's toggled on, so the two never conflict.
          const response = breaking ? (replacementAction || failSafeAction) : null
          if (breaking && !response) return null
          return (
            <div className="mt-4 flex items-start gap-2 rounded-[12px] bg-[#F6F3ED] px-[14px] py-[11px]">
              <Zap size={13} strokeWidth={1.8} className="mt-[2px] shrink-0 text-[#A6A199]" />
              <p className="text-[13px] leading-[1.5] text-[#6F6B62]">
                <span className="font-medium text-[#211F1B]">{cuePhrase}</span>
                {breaking && response && (
                  <>
                    {', I’ll '}
                    {response.toLowerCase().replace(/^i will\s+/i, '')}
                    {' instead'}
                  </>
                )}
              </p>
            </div>
          )
        })()}
      </div>

      <div className="h-px bg-[#ECE9E2]" />

      {/* ── Action zone ── */}
      {done ? (
        <div className="px-[24px] pb-[24px] pt-[22px]">
          <div className="flex animate-bounce-in flex-col items-center pb-[10px] pt-[6px] text-center">
            <div
              className="mb-[14px] grid h-[52px] w-[52px] place-items-center rounded-full bg-[#2F9E6E]"
              style={{ boxShadow: '0 6px 16px rgba(47,158,110,.3)' }}
            >
              <Check size={24} strokeWidth={2.4} className="text-white" />
            </div>
            <div className="mb-1.5 font-serif text-[21px] text-[#211F1B]">
              {breaking
                ? (goal > 0 ? `Clean day #${reps}` : 'Clean day logged')
                : (goal > 0 ? `Vote #${reps} cast` : 'Vote cast')}
            </div>
            {/* The vote moment is their own words, not a generic pat on the back. */}
            {habit.whyText?.trim() ? (
              <>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#A6A199]">
                  {breaking ? 'This clean day is for' : 'This vote is for'}
                </p>
                <p
                  className="mt-1 max-w-[260px] font-serif italic text-[14.5px] leading-[1.55] text-[#6F6B62]"
                  style={{ WebkitLineClamp: 4, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  “{habit.whyText.trim()}”
                </p>
                {habit.goal?.title && (
                  <p className="mt-2 max-w-[260px] text-[12px] font-medium text-[#8A6B3F]">
                    One step closer to: {habit.goal.title}
                  </p>
                )}
              </>
            ) : (
              <p className="max-w-[250px] text-[13.5px] leading-[1.5] text-[#6F6B62]">{doneSubtitle}</p>
            )}
          </div>

          {goal > 0 && (
            <div className="mb-[14px] mt-4">
              <Tally filled={filled} total={goal} color={habitColor.border} />
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#8C887F]">{filled} of {goal} {breaking ? 'clean days' : 'votes'}</span>
                <button
                  onClick={() => unlog.mutate({})}
                  disabled={unlog.isPending}
                  className="text-[12.5px] text-[#8C887F] underline hover:text-[#6F6B62] disabled:opacity-50"
                >
                  Undo
                </button>
              </div>
            </div>
          )}

          {checkCTA && <div className="mb-[14px]">{checkCTA}</div>}

          {habit.celebration?.trim() && (
            <div className="flex items-center justify-center gap-2 rounded-[11px] bg-[#F6F3ED] p-[11px] text-[13px] text-[#6F6B62]">
              <span className="text-[15px]">🎉</span> {habit.celebration.trim()}
            </div>
          )}
        </div>
      ) : relapsedToday ? (
        /* A miss logged today — relapse (break) or an honest "not today" (yes/no).
           Anti-streak framing, no clawback. */
        <div className="px-[24px] pb-[24px] pt-[22px]">
          <div className="flex flex-col items-center pb-[6px] pt-[2px] text-center">
            <div className="mb-[14px] grid h-[52px] w-[52px] place-items-center rounded-full bg-[#C84B31]/10">
              <ShieldOff size={22} strokeWidth={2.1} className="text-[#C84B31]" />
            </div>
            <div className="mb-1.5 font-serif text-[21px] text-[#211F1B]">
              {breaking ? 'Relapse logged' : 'Logged — not today'}
            </div>
            <p className="max-w-[260px] text-[13.5px] leading-[1.5] text-[#6F6B62]">
              {breaking
                ? <>One slip doesn’t erase your progress — your {reps} clean {reps === 1 ? 'day' : 'days'} still stand. Never miss twice; tomorrow is the comeback.</>
                : <>An honest no is still data — your {reps} {reps === 1 ? 'vote' : 'votes'} still stand. Never miss twice; tomorrow’s a fresh vote.</>}
            </p>
          </div>
          {!todayReasonsRecorded && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => setReasonDate(todayDate)}
                className="text-[12.5px] font-medium text-[#8A5347] underline hover:text-[#C84B31]"
              >
                What got in the way?
              </button>
            </div>
          )}
          {checkCTA && <div className="mt-4">{checkCTA}</div>}
          <div className="mt-3 flex justify-center">
            <button
              onClick={() => unlog.mutate({})}
              disabled={unlog.isPending}
              className="text-[12.5px] text-[#8C887F] underline hover:text-[#6F6B62] disabled:opacity-50"
            >
              {breaking ? 'Undo — that wasn’t a relapse' : 'Undo — I actually did it'}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-[24px] pb-[22px] pt-[20px]">
          {/* Section row */}
          <div className="mb-3 flex items-center justify-between">
            <span
              className={cn(
                'text-[11px] font-semibold uppercase tracking-[0.15em]',
                failSafe ? 'text-[#B8714C]' : 'text-[#A6A199]'
              )}
            >
              {failSafe
                ? (breaking ? 'Resisted · still counts' : 'Fail-safe · still counts')
                : isRequiredToday ? (breaking ? 'Today’s clean day' : 'Today’s vote')
                : wp ? (wp.remaining > 0 ? 'Optional today' : 'Week complete')
                : 'Not scheduled today'}
            </span>
            <span className="text-[12px] text-[#A6A199]">Phase {phase?.phaseNumber ?? 1}</span>
          </div>

          {/* Automaticity Check prompt — appears once the rep floor is reached */}
          {checkCTA && <div className="mb-3">{checkCTA}</div>}

          {taper ? (
            /* Taper logger — enter today's count; at/under the limit is a clean vote. */
            <div className="rounded-[16px] bg-[#F6F3ED] p-[18px]">
              <div className="mb-1 text-[16.5px] font-semibold text-[#211F1B]">{target}</div>
              <div className="mb-4 text-[12.5px] leading-[1.45] text-[#8C887F]">
                Limit today: {phase?.dailyLimit ?? 0}. Log honestly — under the line is a vote.
              </div>
              <div className="mb-4 flex items-center justify-center gap-5">
                <button onClick={() => setQty((q) => Math.max(0, q - 1))} className="grid h-[40px] w-[40px] place-items-center rounded-full bg-white text-[#211F1B] shadow-sm" aria-label="Decrease">
                  <Minus size={18} />
                </button>
                <span className="min-w-[40px] text-center font-serif text-[32px] text-[#211F1B]">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="grid h-[40px] w-[40px] place-items-center rounded-full bg-white text-[#211F1B] shadow-sm" aria-label="Increase">
                  <Plus size={18} />
                </button>
              </div>
              <button
                onClick={logTaperCount}
                disabled={log.isPending}
                className="flex w-full items-center justify-center gap-[9px] rounded-[12px] bg-[#1B1A17] px-[15px] py-[15px] text-[14.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
              >
                <Check size={17} strokeWidth={1.9} /> Log today’s count
              </button>
            </div>
          ) : yesNo ? (
            /* Yes/No style — a straight question with two honest answers. */
            <>
              <div className="rounded-[16px] bg-[#F6F3ED] p-[18px]">
                <div className="mb-1 text-[16.5px] font-semibold text-[#211F1B]">
                  {habit.checkQuestion?.trim() || target}
                </div>
                {finishLine && (
                  <div className="mb-3 text-[12.5px] leading-[1.45] text-[#8C887F]">
                    {breaking ? 'Clean when ' : 'Yes when '}{finishLine}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={complete}
                    disabled={log.isPending}
                    className="flex flex-1 items-center justify-center gap-[8px] rounded-[12px] bg-[#1B1A17] px-[15px] py-[14px] text-[14.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
                  >
                    <Check size={17} strokeWidth={2.1} /> Yes
                  </button>
                  <button
                    onClick={sayNo}
                    disabled={log.isPending}
                    className="flex flex-1 items-center justify-center gap-[8px] rounded-[12px] border border-[#E2DED6] bg-white px-[15px] py-[14px] text-[14.5px] font-medium text-[#6F6B62] transition-colors hover:border-[#C84B31]/40 hover:text-[#C84B31] disabled:opacity-50"
                  >
                    <X size={17} strokeWidth={2.1} /> Not this time
                  </button>
                </div>
              </div>

              {/* Tally */}
              {goal > 0 && (
                <div className="mt-[18px]">
                  <Tally filled={filled} total={goal} color={habitColor.border} />
                  <p className="text-[12px] text-[#8C887F]">
                    {filled} of {goal} {breaking ? 'clean days toward breaking free' : 'votes toward who you’re becoming'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Action panel */}
              <div
                className={cn(
                  'rounded-[16px] p-[18px]',
                  failSafe ? 'border border-[#F0DECF] bg-[#FBF4EE]' : 'bg-[#F6F3ED]'
                )}
              >
                <div className="mb-1 text-[16.5px] font-semibold text-[#211F1B]">
                  {failSafe ? habit.failSafeAction : target}
                </div>
                {failSafe ? (
                  <div className="mb-4 text-[12.5px] leading-[1.45] text-[#9A7B62]">
                    {breaking
                      ? 'Feeling the urge and holding is the vote. The 2-minute resist always counts.'
                      : 'Showing up is the vote. The 2-minute version never scales away.'}
                  </div>
                ) : (
                  finishLine && (
                    <div className="mb-4 text-[12.5px] leading-[1.45] text-[#8C887F]">
                      {breaking ? 'Clean when ' : 'Done when '}{finishLine}
                    </div>
                  )
                )}
                {/* Build: temptation bundle (attractive pull). Break: the real cost (make it unattractive). */}
                {!failSafe && habit.temptationBundle?.trim() && (
                  <div className="mb-4 flex items-start gap-1.5 rounded-[10px] bg-[#EFEAF7] px-[11px] py-[8px] text-[12.5px] leading-[1.4] text-[#5B4B86]">
                    <Sparkles size={14} className="mt-[1px] shrink-0 text-[#7F77DD]" />
                    <span>{breaking ? `The cost: ${habit.temptationBundle.trim()}` : `Only while ${habit.temptationBundle.trim()}`}</span>
                  </div>
                )}
                <motion.button
                  onPointerDown={startHold}
                  onPointerUp={cancelHold}
                  onPointerLeave={cancelHold}
                  onPointerCancel={cancelHold}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={log.isPending}
                  className="relative flex w-full touch-none select-none items-center justify-center gap-[9px] overflow-hidden rounded-[12px] bg-[#1B1A17] px-[15px] py-[15px] text-[14.5px] font-semibold text-white transition-colors hover:bg-black"
                >
                  <span
                    className="absolute inset-0 origin-left bg-white/15"
                    style={{ transform: `scaleX(${holdProgress})` }}
                  />
                  <span className="relative flex items-center gap-[9px]">
                    <Target size={17} strokeWidth={1.7} />
                    {holding ? 'Keep holding…' : breaking ? 'Hold to log a clean day' : 'Hold to cast your vote'}
                  </span>
                </motion.button>
              </div>

              {/* Tally */}
              {goal > 0 && (
                <div className="mt-[18px]">
                  <Tally filled={filled} total={goal} color={habitColor.border} />
                  <p className="text-[12px] text-[#8C887F]">
                    {filled} of {goal} {breaking ? 'clean days toward breaking free' : 'votes toward who you’re becoming'}
                  </p>
                </div>
              )}

              {/* Fail-safe / resist toggle */}
              <button
                onClick={() => setFailSafe((v) => !v)}
                className="mt-4 flex w-full items-center gap-[10px] text-left"
              >
                <span
                  className={cn(
                    'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
                    failSafe ? 'bg-[#B8714C]' : 'bg-[#D8D5CD]'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all',
                      failSafe ? 'right-[2px]' : 'left-[2px]'
                    )}
                    style={{ boxShadow: failSafe ? '0 1px 2px rgba(0,0,0,.2)' : '0 1px 2px rgba(0,0,0,.15)' }}
                  />
                </span>
                <span className="text-[12.5px] text-[#6F6B62]">
                  {failSafe
                    ? (breaking ? 'Used the 2-minute resist today. Back to full strength tomorrow.' : 'Fail-safe is on for today. Back to the full version tomorrow.')
                    : (breaking ? 'Urge hit but you held? Log it as a resist.' : 'Too much today? Switch to fail-safe.')}
                </span>
              </button>
            </>
          )}

          {/* Relapse — explicit, honest, no clawback (break only; the yes/no
              style's "Not this time" already covers it) */}
          {breaking && !yesNo && (
            <button
              onClick={relapse}
              disabled={log.isPending}
              className="mt-4 w-full text-center text-[12.5px] text-[#A6A199] underline hover:text-[#C84B31] disabled:opacity-50"
            >
              I slipped today — log a relapse
            </button>
          )}

          {/* Pause — a reversible break when life gets too much. No guilt, no clawback. */}
          <button
            onClick={() => {
              if (confirm('Pause this habit? It’ll drop off your Today list and stop reminding you until you resume it — your history stays put.')) {
                pause.mutate()
              }
            }}
            disabled={pause.isPending}
            className="mt-3 flex w-full items-center justify-center gap-1.5 text-center text-[12px] text-[#A6A199] hover:text-[#6F6B62] disabled:opacity-50"
          >
            <PauseCircle size={13} /> Too much right now? Pause this habit
          </button>
        </div>
      )}

      {/* Goldilocks calibration after a vote — a viewport bottom sheet on mobile
          (so it's never off-screen behind a scrolled card), an in-card slide-up
          on desktop. Dismissible via the backdrop or Skip. */}
      <AnimatePresence>
        {showGoldilocks && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowGoldilocks(false)}
              className="fixed inset-0 z-40 bg-black/20 sm:hidden"
            />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[#ECE9E2] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:absolute sm:z-10 sm:rounded-none sm:pb-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#A6A199]">
                How did that feel?
              </p>
              <button
                onClick={() => setShowGoldilocks(false)}
                className="-my-2 py-2 text-[12.5px] text-[#8C887F] underline hover:text-[#6F6B62]"
              >
                Skip
              </button>
            </div>
            <div className="flex gap-2">
              {GOLDILOCKS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => rate(g.value)}
                  className="flex-1 rounded-[10px] border border-[#E2DED6] bg-[#F6F3ED] py-3 text-sm font-medium text-[#211F1B] hover:border-[#B8714C] hover:bg-[#F0EDE7]"
                >
                  {g.label}
                </button>
              ))}
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Correct a past day — tapped from the WeekStrip. Sets or clears what
          happened; marking a miss chains into the reason sheet for that day. */}
      {(() => {
        const editDay = editDate ? habit.weekStrip?.find((d) => d.date === editDate) : null
        const editHasLog = !!editDay?.status
        return (
          <EditDaySheet
            open={editDate !== null}
            onClose={() => setEditDate(null)}
            date={editDate}
            breaking={breaking}
            taper={taper}
            dailyLimit={phase?.dailyLimit ?? 0}
            currentStatus={editDay?.status ?? null}
            currentQuantity={null}
            hasLog={editHasLog}
            onSetStatus={(status) => {
              if (!editDate) return
              const d = editDate
              log.mutate({ status, date: d })
              setEditDate(null)
              // A backfilled miss deserves the same "what got in the way?" prompt.
              if (status === 'miss') setReasonDate(d)
            }}
            onSetCount={(qty) => {
              if (!editDate) return
              log.mutate({ quantity: qty, date: editDate })
              setEditDate(null)
            }}
            onClear={() => {
              if (!editDate) return
              unlog.mutate({ date: editDate })
              setEditDate(null)
            }}
            saving={log.isPending || unlog.isPending}
          />
        )
      })()}

      {/* "What got in the way?" — after a No/relapse/over-limit day, or the
          next-day catch-up for yesterday's silent miss. Always skippable. */}
      <MissReasonSheet
        open={reasonDate !== null}
        onClose={() => setReasonDate(null)}
        chips={reasonChips}
        title={
          reasonDate && reasonDate !== todayDate
            ? `What got in the way ${format(new Date(`${reasonDate}T12:00:00`), 'EEEE')}?`
            : 'What got in the way?'
        }
        onSave={(reasons, note) => {
          if (!reasonDate) return
          logReason.mutate({ date: reasonDate, reasons, note: note || null })
        }}
        saving={logReason.isPending}
      />

      <AutomaticityCheckModal
        open={showCheck}
        onClose={() => { setShowCheck(false); qc.invalidateQueries({ queryKey: ['today', wsId] }) }}
        wsId={wsId}
        habitId={habit.id}
        habitTitle={habit.title}
        onPassed={(advanced) => {
          setShowCheck(false)
          if (advanced) {
            qc.invalidateQueries({ queryKey: ['today', wsId] })
            qc.invalidateQueries({ queryKey: ['momentum', wsId] })
            toast.success('Phase cleared — your next step is now live.', { icon: '🪜' })
          } else {
            setShowNextPhase(true)
          }
        }}
      />

      <NextPhaseModal
        open={showNextPhase}
        onClose={() => { setShowNextPhase(false); qc.invalidateQueries({ queryKey: ['today', wsId] }) }}
        wsId={wsId}
        habitId={habit.id}
        habitTitle={habit.title}
        nextPhaseNumber={(phase?.phaseNumber ?? 1) + 1}
      />
    </div>
  )
}
