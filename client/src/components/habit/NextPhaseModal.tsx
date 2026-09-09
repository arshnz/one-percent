import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Target } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { habits as habitsApi } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  wsId: string
  habitId: string
  habitTitle: string
  nextPhaseNumber: number
}

export function NextPhaseModal({ open, onClose, wsId, habitId, habitTitle, nextPhaseNumber }: Props) {
  const qc = useQueryClient()
  const [targetText, setTargetText] = useState('')
  const [definitionOfDone, setDefinitionOfDone] = useState('')
  const [targetCount, setTargetCount] = useState(14)

  const create = useMutation({
    mutationFn: () =>
      habitsApi.addPhase(wsId, habitId, {
        targetText: targetText.trim(),
        definitionOfDone: definitionOfDone.trim() || null,
        targetCount,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', wsId] })
      qc.invalidateQueries({ queryKey: ['habits', wsId] })
      qc.invalidateQueries({ queryKey: ['momentum', wsId] })
      toast.success('Next phase set — onward.')
      setTargetText('')
      setDefinitionOfDone('')
      setTargetCount(14)
      onClose()
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save'),
  })

  return (
    <Modal open={open} onClose={onClose} title={`Phase ${nextPhaseNumber} — progressive overload`} size="md">
      <p className="-mt-2 mb-4 text-sm text-text-2">
        <span className="font-medium text-text-1">{habitTitle}</span> is on autopilot. Raise the bar
        a little — the next target should stretch you without breaking the routine.
      </p>
      <div className="space-y-3">
        <Input
          label="New daily target"
          placeholder="Walk 25 mins on the treadmill"
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
        />
        <Input
          label="Definition of done — the exact finish line"
          placeholder="25 mins logged on the treadmill console"
          value={definitionOfDone}
          onChange={(e) => setDefinitionOfDone(e.target.value)}
        />
        <div className="max-w-[220px]">
          <Input
            label="Reps before the next Automaticity Check"
            type="number"
            min={1}
            value={targetCount}
            onChange={(e) => setTargetCount(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button onClick={onClose} className="text-sm text-text-2 hover:text-text-1">
          Later
        </button>
        <Button
          variant="primary"
          size="lg"
          disabled={!targetText.trim() || targetCount < 1}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          <Target size={16} /> Set Phase {nextPhaseNumber}
        </Button>
      </div>
    </Modal>
  )
}
