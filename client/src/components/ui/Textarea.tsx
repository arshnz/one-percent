import { cn } from '@/lib/utils'
import { type TextareaHTMLAttributes, forwardRef } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-text-2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-1',
            'placeholder:text-text-3 resize-none',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-danger',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
