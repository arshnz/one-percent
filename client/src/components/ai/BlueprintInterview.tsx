import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MessagesSquare, Sparkles } from 'lucide-react'
import { auth as firebaseAuth } from '@/lib/firebase'
import { API_BASE } from '@/lib/config'
import type { HabitBlueprint, HabitKind } from '@/types'
import { GuidedChat, type ChatMessage } from '@/components/ai/GuidedChat'

// The co-authored blueprint. A short guided interview (root-vs-branch, where it
// fits, what's worked before) then a one-shot draft that quotes the user's own
// words. Replaces the one-shot Atomizer.
export function BlueprintInterview({
  kind = 'build',
  wsId,
  goalId,
  initialText,
  onApply,
}: {
  kind?: HabitKind
  wsId: string
  goalId?: string | null
  initialText?: string
  onApply: (b: HabitBlueprint) => void
}) {
  const breaking = kind === 'break'
  const opener = breaking
    ? "Let's design your way out of this properly — a plan you'll actually keep. First, the honest question: what's the real problem this habit is solving for you? What do you get from it in the moment?"
    : "Let's co-design this habit so it's genuinely yours. First, the real question underneath it: what problem is this habit actually solving for you — what do you want it to change?"

  // Seed the transcript with the Compass's rough sentence as the user's opener
  // when we arrived from there, so the interview picks up mid-thought.
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialText?.trim()
      ? [{ role: 'model', text: opener }, { role: 'user', text: initialText.trim() }]
      : [{ role: 'model', text: opener }]
  )
  const [open, setOpen] = useState(!!initialText)
  const [streaming, setStreaming] = useState(false)

  const draft = useMutation({
    mutationFn: async () => {
      const token = firebaseAuth.currentUser ? await firebaseAuth.currentUser.getIdToken() : null
      const res = await fetch(`${API_BASE}/api/ai/blueprint-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages, kind }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ message: 'Could not draft the blueprint.' }))
        throw new Error(e.message || 'Could not draft the blueprint.')
      }
      return (await res.json()).blueprint as HabitBlueprint
    },
    onSuccess: (b) => onApply(b),
  })

  const userTurns = messages.filter((m) => m.role === 'user').length

  if (!open) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Sparkles size={16} className="text-accent shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-1">Co-design this habit with AI (Optional)</h2>
            <p className="text-xs text-text-3 truncate">Answer a few questions to automatically draft your blueprint.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-2 hover:border-accent/50 hover:text-text-1 whitespace-nowrap"
        >
          Start co-design
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-5 shadow-card">
      <div className="mb-2 flex items-center justify-between text-accent">
        <div className="flex items-center gap-2">
          <MessagesSquare size={15} />
          <h2 className="text-xs font-semibold uppercase tracking-widest">Design it together</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-text-3 hover:text-accent underline"
        >
          Minimize
        </button>
      </div>
      <p className="mb-3 text-sm text-text-2">
        {breaking
          ? "A few quick questions and I'll draft the whole plan — in your own words — for you to review below."
          : "Answer a few questions and I'll draft the whole blueprint — in your own words — for you to review and tweak below."}
      </p>

      <GuidedChat
        endpoint="/ai/blueprint-interview"
        extraBody={{ kind, wsId, ...(goalId ? { goalId } : {}) }}
        messages={messages}
        onMessagesChange={setMessages}
        onStreamingChange={setStreaming}
        placeholder="Type your answer…"
        className="h-[44vh]"
      />

      {draft.isError && (
        <p className="mt-2 text-xs text-danger">{(draft.error as Error)?.message}</p>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => draft.mutate()}
          disabled={userTurns < 2 || streaming || draft.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {draft.isPending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Drafting…
            </>
          ) : (
            <>
              <Sparkles size={15} /> Draft it
            </>
          )}
        </button>
        <span className="text-xs text-text-3">
          {userTurns < 2 ? 'Answer a couple of questions first' : 'Fills the form below — you can edit everything'}
        </span>
      </div>
    </section>
  )
}
