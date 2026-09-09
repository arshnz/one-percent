import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { habits as habitsApi } from '@/lib/api'
import { triggerConfetti, cn } from '@/lib/utils'

// The 4-item SRBAI (Self-Report Behavioural Automaticity Index).
const ITEMS = [
  'I do it automatically.',
  'I do it without having to consciously remember.',
  'I do it without thinking.',
  'I start doing it before I realise I’m doing it.',
]

const SCALE = [1, 2, 3, 4, 5]

interface Props {
  open: boolean
  onClose: () => void
  wsId: string
  habitId: string
  habitTitle: string
  onPassed: (advanced: boolean) => void
}

export function AutomaticityCheckModal({ open, onClose, wsId, habitId, habitTitle, onPassed }: Props) {
  const [scores, setScores] = useState<(number | null)[]>([null, null, null, null])
  const [failed, setFailed] = useState(false)

  const submit = useMutation({
    mutationFn: () => habitsApi.submitCheck(wsId, habitId, scores as number[]),
    onSuccess: (res) => {
      if (res.passed) {
        triggerConfetti()
        reset()
        onPassed(res.advanced)
      } else {
        setFailed(true)
      }
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not submit'),
  })

  function reset() {
    setScores([null, null, null, null])
    setFailed(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  const complete = scores.every((s) => s !== null)

  return (
    <Modal open={open} onClose={handleClose} title="Automaticity Check" size="md">
      {failed ? (
        <div className="text-center">
          <p className="font-serif text-base text-text-1">Not automatic yet — and that’s fine.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-2">
            Keep casting votes. We’ll check again in about a week. Habits become
            second nature through repetition in a stable context, not by hitting a number.
          </p>
          <Button variant="primary" size="lg" className="mt-5" onClick={handleClose}>
            Keep going
          </Button>
        </div>
      ) : (
        <>
          <p className="-mt-2 mb-4 text-sm text-text-2">
            For <span className="font-medium text-text-1">{habitTitle}</span> — how true is each
            statement right now? <span className="text-text-3">(1 = not at all, 5 = totally)</span>
          </p>
          <div className="space-y-4">
            {ITEMS.map((item, i) => (
              <div key={i}>
                <p className="mb-2 text-sm text-text-1">{item}</p>
                <div className="flex gap-2">
                  {SCALE.map((n) => (
                    <button
                      key={n}
                      onClick={() => setScores((s) => s.map((v, idx) => (idx === i ? n : v)))}
                      className={cn(
                        'h-11 flex-1 rounded-lg border text-sm font-medium transition-colors sm:h-9',
                        scores[i] === n
                          ? 'border-accent bg-accent text-white'
                          : 'border-border bg-bg text-text-2 hover:border-text-3'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-end gap-3">
            <button onClick={handleClose} className="text-sm text-text-2 hover:text-text-1">
              Cancel
            </button>
            <Button
              variant="primary"
              size="lg"
              disabled={!complete}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Submit check
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
