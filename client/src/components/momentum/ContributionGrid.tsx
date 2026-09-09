import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import type { Contribution } from '@/types'

// Graphite scale: 0 votes → paper, more votes → darker ink.
function voteColor(count: number, max: number): string {
  const t = Math.min(count / max, 1)
  const lightness = Math.round(255 * (1 - t))
  const hex = lightness.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

// A scheduled-off day — not a miss, just a planned rest. Filled a calm grey so
// it reads as "nothing owed here", clearly distinct from a black target hit.
const REST_DAY = '#CBC7BF'

function groupByWeek(cells: Contribution[]) {
  const weeks: Contribution[][] = []
  let week: Contribution[] = []
  for (let i = 0; i < cells.length; i++) {
    const dow = new Date(cells[i].date + 'T00:00:00').getDay()
    if (i === 0 && dow !== 0) {
      for (let p = 0; p < dow; p++) week.push({ date: '', count: 0 })
    }
    week.push(cells[i])
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length) weeks.push(week)
  return weeks
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '6m', days: 182 },
  { label: '1y', days: 365 },
] as const

export function ContributionGrid({ cells, max = 5 }: { cells: Contribution[]; max?: number }) {
  const [tip, setTip] = useState<{ cell: Contribution; x: number; y: number } | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [rangeDays, setRangeDays] = useState<number>(30)
  const scrollRef = useRef<HTMLDivElement>(null)
  const modalScrollRef = useRef<HTMLDivElement>(null)

  const visibleCells = rangeDays >= cells.length ? cells : cells.slice(-rangeDays)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [visibleCells.length])

  useEffect(() => {
    if (isExpanded && modalScrollRef.current) {
      setTimeout(() => {
        if (modalScrollRef.current) modalScrollRef.current.scrollLeft = modalScrollRef.current.scrollWidth
      }, 50)
    }
  }, [isExpanded, cells])

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const handleCellEnter = (cell: Contribution, e: React.MouseEvent) => {
    if (!cell.date) return
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTip({ cell, x: rect.left + rect.width / 2, y: rect.top })
  }

  const renderGrid = (sRef: React.RefObject<HTMLDivElement>, gridCells: Contribution[]) => {
    const weeks = groupByWeek(gridCells)
    return (
    <div ref={sRef} className="w-full overflow-x-auto pb-3 scroll-smooth">
      <div className="min-w-max">
          <div className="ml-8 mb-1 flex gap-0.5">
            {weeks.map((w, i) => {
              const first = w.find((c) => c.date)
              return (
                <div key={i} className="w-3.5 flex-shrink-0 text-[8px] text-text-3">
                  {first && i % 4 === 0 ? format(new Date(first.date + 'T00:00:00'), 'MMM') : ''}
                </div>
              )
            })}
          </div>
          <div className="flex gap-0.5">
            <div className="mr-1 flex flex-col gap-0.5">
              {DAYS.map((d, i) => (
                <div key={d} className="flex h-3.5 w-7 items-center text-[8px] text-text-3">
                  {i % 2 === 1 ? d.slice(0, 1) : ''}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-shrink-0 flex-col gap-0.5">
                  {week.map((cell, di) => {
                    // `scheduled === false` means the day asked nothing of you —
                    // a rest day for a fixed-day habit, a day you had slack on
                    // for a weekly quota. Neither is a miss.
                    const isRestDay = cell.date && cell.count === 0 && !cell.wasSavedMiss && cell.scheduled === false
                    const isMiss = cell.date && cell.count === 0 && !cell.wasSavedMiss && cell.scheduled !== false
                    return (
                    <div
                      key={di}
                      className={cn(
                        'heatmap-cell h-3.5 w-3.5 rounded-sm relative overflow-hidden flex-shrink-0',
                        !cell.date && 'opacity-0',
                        isMiss && 'border border-border/50 bg-white'
                      )}
                      style={
                        cell.date && cell.count > 0
                          ? cell.status === 'failsafe'
                            ? { background: 'repeating-linear-gradient(-45deg, #211F1B, #211F1B 2.5px, #F5D24F 2.5px, #F5D24F 5px)' }
                            : { background: voteColor(cell.count, max) }
                          : isRestDay
                            ? { backgroundColor: REST_DAY }
                            : undefined
                      }
                      onMouseEnter={(e) => handleCellEnter(cell, e)}
                      onMouseLeave={() => setTip(null)}
                    >
                      {cell.wasSavedMiss && (
                        <svg viewBox="0 0 14 14" className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                          <rect width="14" height="14" rx="2" fill="#FDFBF7" stroke="#EAE0D5" strokeWidth="0.5"/>
                          <path d="M 1.5 11 L 4.5 8 L 6.5 10 L 9.5 3 L 12.5 4" stroke="#D1B98E" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                          <path d="M 6.5 10 L 8.5 13" stroke="#D1B98E" strokeWidth="0.8" strokeLinecap="round" fill="none"/>
                        </svg>
                      )}
                    </div>
                  )})}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Range selector — keeps a young habit from staring at a year of empty cells. */}
      <div className="mb-2 flex justify-end">
        <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                rangeDays === r.days ? 'bg-white text-text-1 shadow-sm' : 'text-text-3 hover:text-text-2'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {renderGrid(scrollRef, visibleCells)}

      <div className="flex items-center justify-end mt-1">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-1.5 text-[10px] text-text-3 hover:text-text-1 transition-colors"
          title="View full history"
        >
          <Maximize2 size={12} />
          <span>Expand</span>
        </button>
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap rounded-lg bg-text-1 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <p className="font-semibold">{format(new Date(tip.cell.date + 'T00:00:00'), 'EEEE, MMM d')}</p>
          {tip.cell.wasSavedMiss ? (
            <p className="font-medium text-[#D1B98E]">Saved miss — chain protected</p>
          ) : tip.cell.status === 'failsafe' ? (
            <p className="font-medium text-[#F5D24F]">Failsafe vote cast</p>
          ) : tip.cell.count > 0 ? (
            <p>{tip.cell.count} vote{tip.cell.count !== 1 ? 's' : ''} cast</p>
          ) : tip.cell.scheduled === false ? (
            <p className="text-[#CBC7BF]">Nothing owed this day</p>
          ) : tip.cell.missReasons?.length ? (
            <p>Missed — {tip.cell.missReasons.join(', ').toLowerCase()}</p>
          ) : (
            <p>No vote cast</p>
          )}
        </div>
      )}

      <Modal open={isExpanded} onClose={() => setIsExpanded(false)} size="full" title="Full Lifetime Activity">
        <div className="mt-4 relative bg-surface border border-border rounded-xl p-6">
          {renderGrid(modalScrollRef, cells)}
        </div>
      </Modal>
    </div>
  )
}
