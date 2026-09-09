import { useState, useEffect } from 'react'
import { Check, CornerUpRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { GuidedChat, type ChatMessage } from '@/components/ai/GuidedChat'

export type ExerciseKey = 'eulogy' | 'perfect_day' | 'values' | 'future_self'

export const EXERCISE_META: Record<ExerciseKey, { label: string; blurb: string; opener: string }> = {
  eulogy: {
    label: 'The Eulogy',
    blurb: 'Imagine your funeral — what do you want people to say?',
    opener:
      "Let's do something powerful. Picture, years from now, a room full of the people who matter most to you, gathered to celebrate your life. We'll go through what you'd want each of them to say. Ready? Who's the first person you'd want to speak about you?",
  },
  perfect_day: {
    label: 'A Perfect Average Day',
    blurb: 'Walk through one ordinary day in your ideal life.',
    opener:
      "Let's design an ordinary day in your ideal life — not a fantasy, just a normal good day a few years from now. Start at the beginning: where do you wake up, and what are the first few moments of your morning like?",
  },
  values: {
    label: 'Core Values',
    blurb: 'Surface and name what truly drives you.',
    opener:
      "Let's find the values that actually drive you — through stories, not abstractions. Tell me about a moment in the last few years when you felt most alive, most like yourself. What was happening?",
  },
  future_self: {
    label: 'Your 90-Year-Old Self',
    blurb: 'Advice and regrets from your future self.',
    opener:
      "Picture yourself at ninety, in a quiet moment, looking back on a long and well-lived life. They're proud of you. Take a breath and meet them. What's the first thing your 90-year-old self wants you to know?",
  },
}

interface Props {
  open: boolean
  exercise: ExerciseKey | null
  onClose: () => void
  onAddToCanvas: (content: string) => void
}

export function ReflectionChat({ open, exercise, onClose, onAddToCanvas }: Props) {
  const meta = exercise ? EXERCISE_META[exercise] : null
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [addedIdx, setAddedIdx] = useState<number | null>(null)

  // Reset the conversation whenever a new exercise opens.
  useEffect(() => {
    if (open && meta) {
      setMessages([{ role: 'model', text: meta.opener }])
      setAddedIdx(null)
    }
  }, [open, exercise]) // eslint-disable-line react-hooks/exhaustive-deps

  function add(text: string, idx: number) {
    onAddToCanvas(text)
    setAddedIdx(idx)
    setTimeout(() => setAddedIdx((cur) => (cur === idx ? null : cur)), 1800)
  }

  if (!meta) return null

  return (
    <Modal open={open} onClose={onClose} title={meta.label} description={meta.blurb} size="lg">
      <GuidedChat
        endpoint="/ai/reflect"
        extraBody={{ exercise }}
        messages={messages}
        onMessagesChange={setMessages}
        placeholder="Type your reflection…"
        className="h-[60vh]"
        renderMessageExtra={(msg, i, isStreamingThis) =>
          msg.text && !isStreamingThis ? (
            <button
              type="button"
              onClick={() => add(msg.text, i)}
              className="flex items-center gap-1 text-[11px] text-text-3 transition-colors hover:text-accent"
            >
              {addedIdx === i ? (
                <><Check size={11} className="text-success" /><span className="text-success">Added to canvas</span></>
              ) : (
                <><CornerUpRight size={11} /> Add to canvas</>
              )}
            </button>
          ) : null
        }
      />
    </Modal>
  )
}
