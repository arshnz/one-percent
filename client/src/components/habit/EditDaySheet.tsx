import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { format } from 'date-fns'
import { Check, Shield, X, Minus, Plus, Trash2 } from 'lucide-react'
import type { LogStatus } from '@/types'
import { cn } from '@/lib/utils'

// Correct a past day from the WeekStrip — set (or clear) what happened. Same
// bottom-sheet shell as the Goldilocks / miss-reason sheets. Never destructive
// without an explicit tap; closing changes nothing.
export function EditDaySheet({
  open,
  onClose,
  date,
  breaking,
  taper,
  dailyLimit,
  currentStatus,
  currentQuantity,
  hasLog,
  onSetStatus,
  onSetCount,
  onClear,
  saving = false,
}: {
  open: boolean
  onClose: () => void
  date: string | null
  breaking: boolean
  taper: boolean
  dailyLimit: number
  currentStatus: LogStatus | null
  currentQuantity: number | null
  hasLog: boolean
  onSetStatus: (status: LogStatus) => void
  onSetCount: (qty: number) => void
  onClear: () => void
  saving?: boolean
}) {
  const [qty, setQty] = useState(0)
  useEffect(() => {
    if (open) setQty(currentQuantity ?? 0)
  }, [open, currentQuantity])

  const options: { status: LogStatus; label: string; icon: typeof Check; tone: string }[] = breaking
    ? [
        { status: 'target', label: 'Clean day', icon: Check, tone: 'text-[#2F9E6E]' },
        { status: 'failsafe', label: 'Resisted the urge', icon: Shield, tone: 'text-[#B8714C]' },
        { status: 'miss', label: 'Relapsed', icon: X, tone: 'text-[#C84B31]' },
      ]
    : [
        { status: 'target', label: 'Cast the vote', icon: Check, tone: 'text-[#2F9E6E]' },
        { status: 'failsafe', label: 'Fail-safe — still counts', icon: Shield, tone: 'text-[#B8714C]' },
        { status: 'miss', label: 'Missed it', icon: X, tone: 'text-[#C84B31]' },
      ]

  const prettyDate = date ? format(new Date(`${date}T12:00:00`), 'EEEE, MMM d') : ''

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/20 sm:hidden"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[#ECE9E2] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:absolute sm:z-10 sm:rounded-none sm:pb-4"
          >
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#A6A199]">
                Fix {prettyDate}
              </p>
              <button
                onClick={onClose}
                className="-my-2 py-2 text-[12.5px] text-[#8C887F] underline hover:text-[#6F6B62]"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-[12.5px] leading-[1.45] text-[#8C887F]">
              Forgot to log this day? Set what really happened — it counts just the same.
            </p>

            {taper ? (
              <div className="rounded-[14px] bg-[#F6F3ED] p-4">
                <div className="mb-3 text-[12.5px] text-[#8C887F]">
                  Limit that day: {dailyLimit}. Under the line is a vote.
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
                  onClick={() => onSetCount(qty)}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-[9px] rounded-[12px] bg-[#1B1A17] px-[15px] py-[13px] text-[14px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
                >
                  <Check size={17} strokeWidth={1.9} /> Save that day’s count
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {options.map((o) => {
                  const active = currentStatus === o.status
                  return (
                    <button
                      key={o.status}
                      onClick={() => onSetStatus(o.status)}
                      disabled={saving}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left text-[14px] font-medium transition-colors disabled:opacity-50',
                        active
                          ? 'border-[#B8714C] bg-[#FBF4EE] text-[#211F1B]'
                          : 'border-[#E2DED6] bg-[#F6F3ED] text-[#211F1B] hover:border-[#B8714C]'
                      )}
                    >
                      <o.icon size={17} className={o.tone} strokeWidth={2} />
                      <span className="flex-1">{o.label}</span>
                      {active && <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B8714C]">Current</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {hasLog && (
              <button
                onClick={onClear}
                disabled={saving}
                className="mt-3 flex w-full items-center justify-center gap-1.5 text-center text-[12.5px] text-[#A6A199] underline hover:text-[#C84B31] disabled:opacity-50"
              >
                <Trash2 size={13} /> Clear this day
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
