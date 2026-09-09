import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Rocket, Plus, PlayCircle, Compass } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/auth'
import { habits as habitsApi, momentum as momentumApi, goals as goalsApi, checkins as checkinsApi } from '@/lib/api'
import { HabitCard } from '@/components/habit/HabitCard'
import { CheckInCard } from '@/components/checkin/CheckInCard'
import { getDailyQuote } from '@/lib/quotes'
import { readSnooze, writeSnooze, isSnoozed } from '@/lib/checkinSnooze'
import type { Habit, HabitToday } from '@/types'

const SLOTS = 6

export function LaunchpadPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)
  const rawName = useAuthStore((s) => s.user?.name ?? s.user?.email ?? '')
  const firstName = getFirstName(rawName)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['today', wsId],
    queryFn: () => habitsApi.today(wsId!),
    enabled: !!wsId,
  })

  // Warm the Progress tab's data in the background so it opens instantly.
  useEffect(() => {
    if (!wsId) return
    qc.prefetchQuery({ queryKey: ['momentum', wsId], queryFn: () => momentumApi.get(wsId) })
  }, [wsId, qc])

  const { data: roster } = useQuery({
    queryKey: ['habits', wsId],
    queryFn: () => habitsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: goalsData } = useQuery({
    queryKey: ['goals', wsId],
    queryFn: () => goalsApi.list(wsId!),
    enabled: !!wsId,
  })

  // The weekly check-in becomes available from Sunday. Show a banner once the
  // week is due and this week hasn't been reviewed yet — but only if there's
  // something to reflect on.
  const { data: checkinCurrent } = useQuery({
    queryKey: ['checkin-current', wsId],
    queryFn: () => checkinsApi.current(wsId!),
    enabled: !!wsId,
  })
  // Show the check-in whenever it's available — the user asked for it
  // integrated into the daily flow, not locked to Sunday. Once this week's
  // check-in has been saved or skipped (`existing`), it's done — don't keep
  // nagging. A snooze (device-local, until the next day) also hides it.
  const [snooze, setSnooze] = useState(() => (wsId ? readSnooze(wsId) : null))
  useEffect(() => { setSnooze(wsId ? readSnooze(wsId) : null) }, [wsId])
  const checkinDue =
    checkinCurrent &&
    checkinCurrent.summary.length > 0 &&
    !checkinCurrent.existing &&
    !isSnoozed(snooze, checkinCurrent.weekOf)

  const todays = data?.habits ?? []
  const weekday = data?.weekday ?? new Date().getDay()
  // Three tiers, not two: a habit today asks for, a weekly one you could still
  // do today, and one that's genuinely off. A flexible habit with reps left
  // shouldn't sink to the bottom next to a rest day.
  const tier = (h: HabitToday): 0 | 1 | 2 => {
    if (h.weekProgress) return h.weekProgress.obligatedToday ? 0 : h.weekProgress.remaining > 0 ? 1 : 2
    const scheduled: number[] = h.scheduleDays ? JSON.parse(h.scheduleDays) : [0, 1, 2, 3, 4, 5, 6]
    return scheduled.includes(weekday) ? 0 : 2
  }

  // "Left today" counts only what today actually asks for — a weekly habit with
  // slack isn't outstanding work.
  const remaining = todays.filter((h) => {
    if (tier(h) !== 0) return false
    return !h.todayLog || h.todayLog.status === 'miss'
  }).length

  const sortedTodays = [...todays].sort((a, b) => {
    const at = tier(a), bt = tier(b)
    if (at !== bt) return at - bt

    // Within the "asked for today" tier, ones in danger (missed previous) first.
    if (at === 0) {
      if (a.wasPreviousMissed && !b.wasPreviousMissed) return -1
      if (!a.wasPreviousMissed && b.wasPreviousMissed) return 1
    }

    return 0
  })

  const pausedHabits = (roster?.habits ?? []).filter((h) => h.pausedAt)

  const resume = useMutation({
    mutationFn: (id: string) => habitsApi.setPaused(wsId!, id, false),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['today', wsId] })
      await qc.cancelQueries({ queryKey: ['habits', wsId] })
      const prevToday = qc.getQueryData(['today', wsId])
      const prevHabits = qc.getQueryData(['habits', wsId])

      qc.setQueryData<{ habits: Habit[] }>(['habits', wsId], (old) =>
        old ? { ...old, habits: old.habits.map(h => h.id === id ? { ...h, pausedAt: null } : h) } : old
      )
      
      return { prevToday, prevHabits }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prevToday) qc.setQueryData(['today', wsId], ctx.prevToday)
      if (ctx?.prevHabits) qc.setQueryData(['habits', wsId], ctx.prevHabits)
      toast.error('Could not resume this habit')
    },
    onSuccess: () => {
      toast.success('Welcome back — this habit’s live again.')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
    },
  })

  const totalCount = roster?.habits.length ?? todays.length
  const atCap = totalCount >= SLOTS
  // The workbook's focus rule: one habit at a time (two if one's personal and
  // one's professional). Running more than two earns a calm nudge, not a block.
  const runningCount = (roster?.habits ?? []).filter((h) => !h.pausedAt).length

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-7 flex flex-col gap-3 sm:mb-[34px] sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex-1 pr-6">
          <div className="mb-1 flex items-center gap-1.5 text-[#9C988F]">
            <Rocket size={13} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">The Launchpad</span>
          </div>
          <h1 className="font-sans text-[25px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1B1A17] sm:text-[30px]">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[14.5px] text-[#8C887F]">
            {format(new Date(), 'EEEE, MMMM d')}
            {todays.length > 0 && ` · ${remaining} ${remaining === 1 ? 'vote' : 'votes'} left to cast`}
          </p>
          <div className="mt-4 border-l-2 border-[#E0B79F] pl-[14px]">
            <p className="font-serif italic leading-[1.5] text-[#1B1A17]" style={{ fontSize: 16.5 }}>
              "{getDailyQuote()}"
            </p>
          </div>
        </div>

      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#B8714C] border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Weekly check-in — embedded directly so it's part of the habit
              workflow rather than a disconnected separate page. */}
          {checkinDue && (
            <CheckInCard
              current={checkinCurrent}
              wsId={wsId!}
              onSnooze={() => setSnooze(writeSnooze(wsId!, checkinCurrent!.weekOf))}
            />
          )}

          {/* No goals yet → the Compass is the front door: ground habits in the
              user's actual life and bigger goals before engineering anything. */}
          {goalsData && goalsData.goals.length === 0 && (
            <button
              onClick={() => navigate('/app/compass')}
              className="group mb-6 flex w-full max-w-2xl items-start gap-4 rounded-[18px] border border-[#DCCFBB] bg-gradient-to-br from-[#FBF6EC] to-[#F6EFE2] p-5 text-left transition-shadow hover:shadow-md"
            >
              <span className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full bg-[#1B1A17] text-white">
                <Compass size={20} />
              </span>
              <span>
                <span className="block text-[16px] font-semibold text-[#211F1B]">Set your bearings first</span>
                <span className="mt-1 block text-[13.5px] leading-[1.5] text-[#6F6B62]">
                  Habits stick when they serve something bigger. Ten minutes in the Compass maps where you are,
                  where you're heading, and the one habit that starts the path.
                </span>
                <span className="mt-2 inline-block text-[13px] font-semibold text-[#8A6B3F] group-hover:underline">
                  Open the Compass →
                </span>
              </span>
            </button>
          )}
          {totalCount === 0 && (
            <p className="mb-6 max-w-lg text-[14.5px] leading-relaxed text-[#8C887F]">
              One habit, built properly, beats six started at once. Engineer your first —
              every vote you cast is a step toward who you want to become.
            </p>
          )}

          {/* Focus nudge — the workbook is emphatic: one habit at a time. */}
          {runningCount > 2 && (
            <div className="mb-6 max-w-2xl rounded-[14px] border border-[#E4DCC9] bg-[#FBF7EC] px-4 py-3 text-[13.5px] leading-[1.5] text-[#6F6B62]">
              <span className="font-semibold text-[#211F1B]">A word on focus:</span> the more change you take on
              at once, the less of it sticks. The rule of thumb is one personal habit, one professional — you're
              running {runningCount}. Consider pausing the rest until one feels automatic.
            </div>
          )}
          <div
            className="grid items-start"
            style={{ gap: 22, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))' }}
          >
            {sortedTodays.map((h) => (
              <HabitCard key={h.id} habit={h} wsId={wsId!} weekday={data?.weekday} />
            ))}

            {/* Single add-a-habit tile — shown while under cap */}
            {!atCap && (
              <button
                onClick={() => navigate('/app/architect')}
                className="group flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-[20px] bg-transparent text-[#9C988F] transition-colors hover:bg-[#F5F3EE] sm:min-h-[300px]"
                style={{ border: '1.5px dashed #CFC9BF' }}
              >
                <span
                  className="grid h-[42px] w-[42px] place-items-center rounded-full transition-colors group-hover:bg-[#F0DDD3]"
                  style={{ background: '#E4E1DA' }}
                >
                  <Plus size={20} className="transition-colors group-hover:text-[#B8714C]" />
                </span>
                <span
                  className="text-[14px] font-semibold transition-colors group-hover:text-[#B8714C]"
                >
                  Add a habit
                </span>
              </button>
            )}
          </div>

          {/* Paused habits — resting, not gone. One tap to bring them back. */}
          {pausedHabits.length > 0 && (
            <div className="mt-10">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9C988F]">
                Paused · {pausedHabits.length}
              </h2>
              <div className="flex flex-col gap-2">
                {pausedHabits.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-3 rounded-[14px] border border-[#E4E1DA] bg-[#F5F3EE] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-[#6F6B62]">{h.title}</p>
                      <p className="text-[12px] text-[#A6A199]">Resting — no votes owed, no streak lost.</p>
                    </div>
                    <button
                      onClick={() => resume.mutate(h.id)}
                      disabled={resume.isPending}
                      className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-white px-3 py-2 text-[13px] font-semibold text-[#211F1B] transition-colors hover:bg-[#FBFAF8] disabled:opacity-50"
                      style={{ border: '1px solid #DCD8D1' }}
                    >
                      <PlayCircle size={15} className="text-[#6F6B62]" /> Resume
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function getFirstName(fullNameOrEmail: string): string {
  if (!fullNameOrEmail) return ''
  let base = fullNameOrEmail.split('@')[0]
  base = base.split(' ')[0]
  base = base.split('.')[0]
  if (!base) return ''
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
}
