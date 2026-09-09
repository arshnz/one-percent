import { NavLink } from 'react-router-dom'
import { MessageCircleHeart, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

// The two tabs of the Learning section — the Habit Coach (ask-anything, grounded
// in the book) and Theory (the static refresher). Rendered at the top of both
// pages so they read as one section with two views.
const TABS = [
  { to: '/app/coach', icon: MessageCircleHeart, label: 'Habit Coach' },
  { to: '/app/theory', icon: BookOpen, label: 'Theory' },
]

export function LearningTabs() {
  return (
    <div className="mb-5 flex shrink-0 gap-1 border-b border-border">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-accent text-text-1'
                : 'border-transparent text-text-3 hover:text-text-1'
            )
          }
        >
          <t.icon size={15} className="shrink-0" />
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
