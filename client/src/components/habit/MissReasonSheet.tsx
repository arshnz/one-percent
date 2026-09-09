import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

// "What got in the way?" capture — multi-select chips plus an optional note.
// Same shell as the Goldilocks sheet: a viewport bottom sheet on mobile, an
// in-card slide-up on desktop. Always skippable; saving is never required.
export function MissReasonSheet({
  open,
  onClose,
  chips,
  title = 'What got in the way?',
  subtitle = 'No judgment — naming it helps you plan around it.',
  onSave,
  saving = false,
}: {
  open: boolean
  onClose: () => void
  chips: string[]
  title?: string
  subtitle?: string
  onSave: (reasons: string[], note: string) => void
  saving?: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  // Fresh sheet each time it opens.
  useEffect(() => {
    if (open) { setSelected([]); setNote('') }
  }, [open])

  function toggle(chip: string) {
    setSelected((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : prev.length >= 5 ? prev : [...prev, chip]
    )
  }

  const canSave = selected.length > 0 || note.trim().length > 0

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
                {title}
              </p>
              <button
                onClick={onClose}
                className="-my-2 py-2 text-[12.5px] text-[#8C887F] underline hover:text-[#6F6B62]"
              >
                Skip
              </button>
            </div>
            <p className="mb-3 text-[12.5px] leading-[1.45] text-[#8C887F]">{subtitle}</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {chips.map((chip) => {
                const active = selected.includes(chip)
                return (
                  <button
                    key={chip}
                    onClick={() => toggle(chip)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                      active
                        ? 'border-[#B8714C] bg-[#FBF4EE] text-[#8A5A38]'
                        : 'border-[#E2DED6] bg-[#F6F3ED] text-[#211F1B] hover:border-[#B8714C] hover:bg-[#F0EDE7]'
                    )}
                  >
                    {chip}
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Anything else? (optional)"
              className="mb-3 w-full rounded-[10px] border border-[#E2DED6] bg-white px-3 py-2.5 text-[13.5px] text-[#211F1B] placeholder:text-[#A6A199] focus:border-[#B8714C] focus:outline-none"
            />
            <button
              onClick={() => onSave(selected, note.trim())}
              disabled={!canSave || saving}
              className="w-full rounded-[12px] bg-[#1B1A17] px-[15px] py-[13px] text-[14px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
