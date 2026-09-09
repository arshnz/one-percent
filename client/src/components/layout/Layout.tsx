import { NavLink, useLocation } from 'react-router-dom'
import { Rocket, BarChart3, Compass, MessageCircleHeart, Settings } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NavBar } from './NavBar'

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // The Vision Canvas needs the full viewport — skip the centered container.
  const fullBleed = pathname.startsWith('/app/canvas')


  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('sidebar-collapsed') === '1'
  )
  function toggleSidebar() {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }

  return (
    <div className="flex min-h-screen bg-bg text-text-1">
      {/* Desktop sidebar */}
      <aside
        className={cn('hidden shrink-0 md:block', collapsed ? 'w-[76px]' : 'w-[248px]')}
        style={{
          borderRight: '1px solid #DCD8D1',
          transition: 'width .24s ease',
        }}
      >
        <div className="sticky top-0 h-screen">
          <NavBar collapsed={collapsed} onToggle={toggleSidebar} />
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-y-auto" style={{ background: '#E9E7E2' }}>
        {fullBleed ? (
          children
        ) : (
          <div className="mx-auto w-full max-w-[1600px] px-6 pb-[72px] pt-[44px] md:px-[48px]">
            {children}
          </div>
        )}
      </main>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {/* Compass replaces Canvas on mobile — the infinite board wants a big
            screen anyway, and stays one tap away on desktop. */}
        {[
          { to: '/app', icon: Rocket, label: 'Launchpad', end: true },
          { to: '/app/compass', icon: Compass, label: 'Compass' },
          { to: '/app/coach', icon: MessageCircleHeart, label: 'Learning' },
          { to: '/app/momentum', icon: BarChart3, label: 'Momentum' },
          { to: '/app/settings', icon: Settings, label: 'Settings' },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium',
                isActive ? 'text-accent' : 'text-text-3'
              )
            }
          >
            <item.icon size={19} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
