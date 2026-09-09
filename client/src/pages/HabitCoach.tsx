import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import {
  MessageCircleHeart, Send, BookOpen, Plus, Trash2, Pencil, Check, X, MessagesSquare,
} from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import toast from 'react-hot-toast'
import type { CoachMessage } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { coach as coachApi } from '@/lib/api'
import { streamAI } from '@/lib/stream'
import { LearningTabs } from '@/components/layout/LearningTabs'
import { cn } from '@/lib/utils'

// Coach replies come back as markdown — render them with styling that matches
// the card palette. (User messages stay plain text.)
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[#1B1A17]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h3 className="mb-1 mt-1 font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-1 font-semibold">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 font-semibold">{children}</h3>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-[#B8714C] underline">{children}</a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[#ECE9E2] px-1 py-0.5 font-mono text-[13px]">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#E0B79F] pl-3 italic text-[#6F6B62]">{children}</blockquote>
  ),
}

const OPENING: CoachMessage = {
  role: 'model',
  text: "Kia ora — I'm your Habit Coach, and everything I know comes straight from James Clear's Atomic Habits. Ask me anything about building a habit, breaking one, or getting unstuck, and I'll ground my advice in the book and your own habits. What's on your mind?",
}

const SUGGESTIONS = [
  'How do I make a new habit stick?',
  'I keep breaking my streak — what should I do?',
  'How do I make a bad habit harder to do?',
  'What does the book say about motivation vs. systems?',
]

export function HabitCoachPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)
  const qc = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<CoachMessage[]>([OPENING])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [mobileListOpen, setMobileListOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: convos } = useQuery({
    queryKey: ['coachConvos', wsId],
    queryFn: () => coachApi.listConversations(wsId!),
    enabled: !!wsId,
  })
  const conversations = convos?.conversations ?? []

  // Scroll the thread container itself, not the page — scrollIntoView would also
  // scroll the window and push a tall chat's messages off the top on submit.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Escape closes the mobile chat drawer.
  useEffect(() => {
    if (!mobileListOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMobileListOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileListOpen])

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => coachApi.renameConversation(wsId!, id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coachConvos', wsId] }),
    onError: () => toast.error('Could not rename chat'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => coachApi.deleteConversation(wsId!, id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['coachConvos', wsId] })
      if (id === selectedId) newChat()
    },
    onError: () => toast.error('Could not delete chat'),
  })

  function newChat() {
    if (streaming) return
    setSelectedId(null)
    setMessages([OPENING])
    setError(null)
    setMobileListOpen(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function selectConversation(id: string) {
    if (streaming || id === selectedId) { setMobileListOpen(false); return }
    setError(null)
    setMobileListOpen(false)
    setLoadingThread(true)
    setSelectedId(id)
    try {
      const { conversation } = await coachApi.getConversation(wsId!, id)
      setMessages([OPENING, ...conversation.messages])
    } catch {
      setError('Could not load that conversation.')
      setMessages([OPENING])
    } finally {
      setLoadingThread(false)
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming || !wsId) return

    setError(null)

    // Lazily create the conversation on the first message so empty chats never
    // clutter the list.
    let convoId = selectedId
    if (!convoId) {
      try {
        const { conversation } = await coachApi.createConversation(wsId)
        convoId = conversation.id
        setSelectedId(convoId)
      } catch {
        setError('Could not start a new chat. Try again.')
        return
      }
    }

    const withUser = [...messages, { role: 'user', text: trimmed } as CoachMessage]
    setMessages([...withUser, { role: 'model', text: '' }])
    setInput('')
    setStreaming(true)

    try {
      await streamAI('/ai/coach', { messages: withUser, wsId, conversationId: convoId }, (chunk) => {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          updated[updated.length - 1] = { ...last, text: last.text + chunk }
          return updated
        })
      })
      // The server persisted the exchange + (for a new chat) named it — refresh
      // the list so the title and ordering update.
      qc.invalidateQueries({ queryKey: ['coachConvos', wsId] })
    } catch (err: any) {
      setMessages((prev) => prev.slice(0, -1))
      setError(err?.message ?? 'The coach is unavailable right now. Try again in a moment.')
    } finally {
      setStreaming(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  function startRename(id: string, current: string) {
    setEditingId(id)
    setEditValue(current)
  }
  function commitRename() {
    if (editingId && editValue.trim()) rename.mutate({ id: editingId, title: editValue.trim() })
    setEditingId(null)
  }

  const threadEmpty = messages.length === 1

  // The conversation list — shared between the desktop rail and mobile drawer.
  const list = (
    <>
      <button
        onClick={newChat}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#1B1A17] px-3 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-black"
      >
        <Plus size={16} /> New chat
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-1 py-2 text-[12.5px] leading-relaxed text-[#9C988F]">
            Your saved chats will appear here. Start one and it's kept automatically.
          </p>
        )}
        {conversations.map((c) => {
          const active = c.id === selectedId
          return (
            <div key={c.id} className="group relative">
              {editingId === c.id ? (
                <div className="flex items-center gap-1 rounded-[10px] bg-white px-2 py-1.5">
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null) }}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[#211F1B] focus:outline-none"
                  />
                  <button onClick={commitRename} className="text-[#2F9E6E]"><Check size={14} /></button>
                  <button onClick={() => setEditingId(null)} className="text-[#9C988F]"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={() => selectConversation(c.id)}
                  className={cn(
                    'w-full rounded-[10px] px-3 py-2 pr-12 text-left transition-colors',
                    active ? 'bg-[#E7E3DB]' : 'hover:bg-[#EFECE6]'
                  )}
                >
                  <div className="truncate text-[13px] font-medium text-[#211F1B]">{c.title}</div>
                  <div className="mt-0.5 text-[11px] text-[#9C988F]">
                    {formatDistanceToNowStrict(new Date(c.lastMessageAt), { addSuffix: true })}
                  </div>
                </button>
              )}
              {editingId !== c.id && (
                <div className="absolute right-1.5 top-1.5 flex gap-0.5 md:hidden md:group-hover:flex">
                  <button
                    onClick={() => startRename(c.id, c.title)}
                    aria-label="Rename chat"
                    className="grid h-7 w-7 place-items-center rounded-md text-[#9C988F] hover:bg-white hover:text-[#6F6B62]"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this chat? This can’t be undone.')) remove.mutate(c.id) }}
                    aria-label="Delete chat"
                    className="grid h-7 w-7 place-items-center rounded-md text-[#9C988F] hover:bg-white hover:text-[#B93B3B]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <div className="animate-fade-in flex h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] flex-col md:h-[calc(100dvh-6rem)]">
      <LearningTabs />
      {/* Header */}
      <header className="mb-4 flex shrink-0 items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[#9C988F]">
            <MessageCircleHeart size={14} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">Habit Coach</span>
          </div>
          <h1 className="font-serif text-[20px] font-normal tracking-[-0.01em] text-[#1B1A17] sm:text-[26px]">
            Coaching, grounded in the book
          </h1>
          <p className="mt-1 hidden items-center gap-1.5 text-[13.5px] text-[#8C887F] sm:flex">
            <BookOpen size={13} className="shrink-0" />
            Every answer draws on <span className="italic">Atomic Habits</span> by James Clear.
          </p>
        </div>
        {/* Mobile: open chat list */}
        <button
          onClick={() => setMobileListOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[#DCD8D1] bg-white px-3 py-2 text-[13px] font-medium text-[#6F6B62] md:hidden"
        >
          <MessagesSquare size={15} /> Chats
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Desktop rail */}
        <aside className="hidden w-64 shrink-0 flex-col rounded-[20px] bg-[#ECEAE5] p-3 md:flex">
          {list}
        </aside>

        {/* Thread */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-[20px] bg-white p-5 md:p-6"
            style={{ boxShadow: '0 1px 2px rgba(20,18,15,.04), 0 10px 30px rgba(20,18,15,.06)' }}
          >
            {loadingThread ? (
              <div className="flex justify-center py-16">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#B8714C] border-t-transparent" />
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-[16px] px-4 py-3 text-[14.5px] leading-relaxed',
                        msg.role === 'user'
                          ? 'whitespace-pre-wrap bg-[#1B1A17] text-white'
                          : 'bg-[#F6F3ED] text-[#211F1B]'
                      )}
                    >
                      {msg.role === 'model' ? (
                        msg.text ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                            {msg.text}
                          </ReactMarkdown>
                        ) : (
                          <span className="flex gap-1 text-[#8C887F]">
                            <span className="animate-bounce">•</span>
                            <span className="animate-bounce [animation-delay:0.1s]">•</span>
                            <span className="animate-bounce [animation-delay:0.2s]">•</span>
                          </span>
                        )
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}

                {error && <p className="text-center text-[13px] text-[#B93B3B]">{error}</p>}

                {threadEmpty && !streaming && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-full border border-[#E2DED6] bg-white px-4 py-2.5 text-[14px] text-[#6F6B62] transition-colors hover:border-[#B8714C] hover:text-[#B8714C]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

              </>
            )}
          </div>

          {/* Input */}
          <div className="mt-3 flex shrink-0 items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask the coach anything about your habits…"
              disabled={streaming}
              className="max-h-32 flex-1 resize-none rounded-[14px] border border-[#DCD8D1] bg-white px-4 py-3 text-[14.5px] text-[#211F1B] placeholder:text-[#9C988F] focus:border-[#B8714C] focus:outline-none focus:ring-1 focus:ring-[#B8714C]/30 disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || streaming}
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] bg-[#1B1A17] text-white transition-opacity hover:bg-black disabled:opacity-35"
            >
              <Send size={17} />
            </button>
          </div>
        </section>
      </div>

      {/* Mobile drawer */}
      {mobileListOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileListOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[78%] max-w-xs flex-col bg-[#ECEAE5] p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9C988F]">Your chats</span>
              <button onClick={() => setMobileListOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-md text-[#9C988F] hover:bg-[#E2DFD8]"><X size={18} /></button>
            </div>
            {list}
          </div>
        </div>
      )}
    </div>
  )
}
