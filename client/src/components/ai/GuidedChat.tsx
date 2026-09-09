import { useState, useRef, useEffect, KeyboardEvent, ReactNode } from 'react'
import { Send } from 'lucide-react'
import { streamAI } from '@/lib/stream'
import { cn } from '@/lib/utils'

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

interface Props {
  endpoint: string
  // Extra request body fields alongside `messages` (e.g. { stage }, { exercise }).
  extraBody?: Record<string, unknown>
  // Controlled transcript — parents keep it so they can extract/persist it.
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onStreamingChange?: (streaming: boolean) => void
  placeholder?: string
  disabled?: boolean
  // Optional per-message action row (e.g. "Add to canvas").
  renderMessageExtra?: (msg: ChatMessage, index: number, streaming: boolean) => ReactNode
  className?: string
}

// The shared guided-conversation surface: message list + composer + SSE
// streaming. Used by the Vision Canvas reflections, the Compass, the blueprint
// interview, and the weekly check-in.
export function GuidedChat({
  endpoint,
  extraBody,
  messages,
  onMessagesChange,
  onStreamingChange,
  placeholder = 'Type your reply…',
  disabled = false,
  renderMessageExtra,
  className,
}: Props) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the latest message in view by scrolling the list container itself —
  // NOT scrollIntoView, which also scrolls the page and can push a tall chat's
  // messages off the top of the viewport on submit.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function setStreamingBoth(v: boolean) {
    setStreaming(v)
    onStreamingChange?.(v)
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming || disabled) return
    setError(null)
    const withUser: ChatMessage[] = [...messages, { role: 'user', text }]
    // `current` is the source of truth during the stream — chunk updates build
    // on it directly so parent state timing can't drop text.
    let current: ChatMessage[] = [...withUser, { role: 'model', text: '' }]
    onMessagesChange(current)
    setInput('')
    setStreamingBoth(true)
    try {
      await streamAI(endpoint, { ...extraBody, messages: withUser }, (chunk) => {
        const last = current[current.length - 1]
        current = [...current.slice(0, -1), { ...last, text: last.text + chunk }]
        onMessagesChange(current)
      })
    } catch (err: any) {
      onMessagesChange(withUser)
      setError(err?.message ?? 'Something went wrong. Try again.')
    } finally {
      setStreamingBoth(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'rounded-tr-sm bg-accent text-white'
                  : 'rounded-tl-sm border border-border bg-bg text-text-1'
              )}
            >
              {msg.text || (
                <span className="flex gap-1 text-text-3">
                  <span className="animate-bounce">•</span>
                  <span className="animate-bounce [animation-delay:0.1s]">•</span>
                  <span className="animate-bounce [animation-delay:0.2s]">•</span>
                </span>
              )}
            </div>
            {renderMessageExtra?.(msg, i, streaming && i === messages.length - 1)}
          </div>
        ))}
        {error && <p className="text-center text-xs text-danger">{error}</p>}
      </div>

      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={streaming || disabled}
          className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || streaming || disabled}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white transition-opacity disabled:opacity-35"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
