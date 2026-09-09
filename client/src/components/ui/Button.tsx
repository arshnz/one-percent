import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'btn-gradient',
  secondary: 'bg-surface-2 text-text-1 border border-border hover:bg-surface hover:border-text-3',
  ghost: 'text-text-2 hover:text-text-1 hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs rounded-md',
  md: 'h-11 px-4 text-sm rounded-lg sm:h-9',
  lg: 'h-11 px-6 text-base rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
)
Button.displayName = 'Button'
