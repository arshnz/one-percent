import type { WeekStripDay } from '@/types'
import { cn } from '@/lib/utils'

// The never-miss-twice strip — the workbook's green-dot/red-dot tracker.
// Green = showed up (target), amber = fail-safe (still a vote), red = missed a
// scheduled day, hollow = today still open, faint = rest day / before the habit
// existed. Two reds in a row get a warning ring: never miss twice.
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

type DotKind = 'vote' | 'failsafe' | 'miss' | 'open' | 'rest'

function dotKind(day: WeekStripDay, isToday: boolean): DotKind {
  if (!day.scheduled) return 'rest'
  if (day.status === 'target') return 'vote'
  if (day.status === 'failsafe') return 'failsafe'
  if (day.status === 'miss') return 'miss'
  // No log: today is still open; a past scheduled day is a miss.
  return isToday ? 'open' : 'miss'
}

export function WeekStrip({
  days,
  accentColor,
  onEditDay,
}: {
  days: WeekStripDay[]
  accentColor?: string
  // Tap a day to correct it. Only editable days (creation → today) are tappable.
  onEditDay?: (date: string) => void
}) {
  if (!days?.length) return null
  const kinds = days.map((d, i) => dotKind(d, i === days.length - 1))

  return (
    <div className="mt-3 flex items-end gap-[10px]" aria-label="Last 7 days">
      {days.map((d, i) => {
        const kind = kinds[i]
        const secondMiss = kind === 'miss' && kinds[i - 1] === 'miss'
        const weekday = new Date(`${d.date}T12:00:00`).getDay()
        const isToday = i === days.length - 1
        // Today has the card's main control; the strip edits past days only.
        const canEdit = !!onEditDay && d.editable && !isToday
        const dot = (
          <span
            className={cn(
              'h-[11px] w-[11px] rounded-full transition-colors',
              kind === 'failsafe' && 'bg-[#E0A93E]',
              kind === 'miss' && 'bg-[#C84B31]',
              kind === 'open' && 'border-[1.5px] border-[#B4AFA6] bg-transparent',
              kind === 'rest' && 'bg-[#E7E3DB]',
              secondMiss && 'ring-2 ring-[#C84B31]/30 ring-offset-1'
            )}
            style={kind === 'vote' ? { backgroundColor: accentColor ?? '#2F9E6E' } : undefined}
          />
        )
        return (
          <div key={d.date} className="flex flex-col items-center gap-[4px]">
            {canEdit ? (
              <button
                type="button"
                onClick={() => onEditDay!(d.date)}
                title={`${d.date} — tap to edit`}
                aria-label={`Edit ${d.date}`}
                className="grid h-[22px] w-[22px] place-items-center rounded-full transition-colors hover:bg-[#F0EDE7]"
              >
                {dot}
              </button>
            ) : (
              <span className="grid h-[22px] w-[22px] place-items-center" title={`${d.date}${kind === 'miss' ? ' — missed' : ''}`}>
                {dot}
              </span>
            )}
            <span className={cn('text-[9px] font-medium', isToday ? 'text-[#6F6B62]' : 'text-[#B4AFA6]')}>
              {DAY_LETTERS[weekday]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
