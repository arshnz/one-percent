import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  colour?: string
  className?: string
  onRemove?: () => void
}

export function Badge({ children, colour = '#6e6e68', className, onRemove }: BadgeProps) {
  // Derive a readable text colour from the background
  const bg = colour
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        className
      )}
      style={{ backgroundColor: bg + '26', color: bg, border: `1px solid ${bg}40` }}
    >
      {children}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="hover:opacity-70 ml-0.5"
          aria-label="Remove tag"
        >
          ×
        </button>
      )}
    </span>
  )
}
