import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-5xl', full: 'max-w-[95vw] w-full' }

export function Modal({ open, onClose, title, description, children, className, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-text-1/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'relative z-50 max-h-[90dvh] w-full overflow-y-auto bg-surface rounded-2xl shadow-card-hover p-6',
              'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
              sizes[size],
              className
            )}
          >
            {(title != null || onClose != null) && (
              <div className="flex items-start justify-between mb-4">
                <div>
                  {title && <h2 className="font-serif text-lg font-medium text-text-1 tracking-tight">{title}</h2>}
                  {description && <p className="text-sm text-text-2 mt-1">{description}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="text-text-3 hover:text-text-2 ml-4 flex-shrink-0 -mt-1"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
