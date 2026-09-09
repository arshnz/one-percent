import { useState, useEffect, useRef, memo } from 'react'
import { Quote as QuoteIcon } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'
import type { CanvasNodeType, StickyColor } from '@/types'
import { cn } from '@/lib/utils'

export interface StickyData extends Record<string, unknown> {
  type: CanvasNodeType
  content: string
  imageUrl: string | null
  color: StickyColor
  width: number
  onChange: (id: string, content: string) => void
}

const COLORS: Record<StickyColor, string> = {
  yellow: 'bg-[#f7f0c8] border-[#e3d894]',
  blue: 'bg-[#dae5f0] border-[#b6cae0]',
  green: 'bg-[#d8e8dc] border-[#b2d2ba]',
  pink: 'bg-[#f1dde4] border-[#dcbecb]',
  plain: 'bg-surface border-border',
}

function StickyNodeInner({ id, data, selected }: NodeProps & { data: StickyData }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [value, setValue] = useState(data.content)

  // Sync external updates (rebuilds from the server) — but never while the user
  // is actively editing, so the caret doesn't jump.
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(data.content)
  }, [data.content])

  const save = (v: string) => { if (v !== data.content) data.onChange(id, v) }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => save(v), 500)
  }

  const handleBlur = () => {
    window.clearTimeout(timer.current)
    save(value)
  }

  return (
    <div
      style={{ width: data.width }}
      className={cn(
        'rounded-xl border p-3 shadow-card transition-shadow',
        COLORS[data.color],
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg'
      )}
    >
      {data.type === 'image' && data.imageUrl ? (
        <img src={data.imageUrl} alt="" className="mb-1 w-full rounded-lg object-cover" draggable={false} />
      ) : null}

      {data.type === 'quote' && <QuoteIcon size={14} className="mb-1 text-text-3" />}

      {data.type !== 'image' ? (
        <textarea
          ref={ref}
          className={cn(
            'nodrag nowheel w-full resize-none border-none bg-transparent text-sm text-text-1 placeholder:text-text-3 focus:outline-none',
            data.type === 'quote' && 'font-serif italic'
          )}
          rows={Math.max(2, value.split('\n').length)}
          placeholder={data.type === 'quote' ? 'A quote that moves you…' : 'What does this represent?'}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      ) : (
        <textarea
          ref={ref}
          className="nodrag nowheel w-full resize-none border-none bg-transparent text-xs text-text-2 placeholder:text-text-3 focus:outline-none"
          rows={1}
          placeholder="Caption…"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      )}
    </div>
  )
}

export const StickyNode = memo(StickyNodeInner)
