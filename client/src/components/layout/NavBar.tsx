import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Rocket, BarChart3, Sparkles, Settings, LogOut, GraduationCap, Activity,
  Compass, PanelLeftClose, PanelLeftOpen, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { auth as firebaseAuth } from '@/lib/firebase'
import { auth as authApi } from '@/lib/api'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
  // Extra path prefixes that should also mark this item active (e.g. a section
  // with sub-tabs living on different routes).
  match?: string[]
}

// Architect is intentionally absent — habits are created/edited from the
// Launchpad itself, so it needs no standalone nav entry.
const items: NavItem[] = [
  { to: '/app', icon: Rocket, label: 'Launchpad', end: true },
  { to: '/app/compass', icon: Compass, label: 'Compass' },
  { to: '/app/coach', icon: GraduationCap, label: 'Learning', match: ['/app/coach', '/app/theory'] },
  { to: '/app/momentum', icon: BarChart3, label: 'Momentum' },
  { to: '/app/body', icon: Activity, label: 'The Body' },
  { to: '/app/canvas', icon: Sparkles, label: 'Vision Canvas' },
  { to: '/app/settings', icon: Settings, label: 'Settings' },
]

export function NavBar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)

  async function handleSignOut() {
    try { await authApi.logout() } catch { /* noop */ }
    await firebaseAuth.signOut()
    logout()
    navigate('/', { replace: true })
  }

  const displayName = user?.name ?? user?.email ?? 'You'
  const initial = displayName.charAt(0).toUpperCase()
  const { pathname } = useLocation()

  return (
    <nav className="flex h-full flex-col" style={{ background: '#ECEAE5' }}>
      {/* Brand row */}
      <div
        className={cn(
          'flex h-[72px] shrink-0 items-center px-[18px]',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <NavLink to="/app" className="flex items-center gap-2.5">
            <span
              className="grid h-[30px] w-[30px] shrink-0 place-items-center"
              style={{ background: '#1B1A17', borderRadius: 9 }}
            >
              <Rocket size={14} className="text-white" />
            </span>
            <span className="text-[15.5px] font-bold leading-none text-[#1B1A17]">Launchpad</span>
          </NavLink>
        )}
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="grid h-[34px] w-[34px] shrink-0 place-items-center text-[#8C887F] transition-colors hover:bg-[#E0DDD5] hover:text-[#5C584F]"
          style={{ borderRadius: 9 }}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-1 px-[14px] py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => {
              const active = isActive || (item.match?.some((p) => pathname.startsWith(p)) ?? false)
              return cn(
                'flex items-center gap-[13px] rounded-[11px] px-[11px] py-[11px] text-[14.5px] transition-colors',
                collapsed && 'justify-center',
                active
                  ? 'bg-[#1B1A17] font-semibold text-white'
                  : 'font-medium text-[#6F6B62] hover:bg-[#E2DFD8] hover:text-[#211F1B]'
              )
            }}
          >
            <item.icon size={20} className="shrink-0" />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </div>

      {/* Footer */}
      <div
        className="mt-auto px-[14px] pb-4 pt-3"
        style={{ borderTop: '1px solid #DCD8D1' }}
      >
        <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center')}>
          <span
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: '#1B1A17' }}
          >
            {initial}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-[#1B1A17]">{displayName}</div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] text-[#9C988F] transition-colors hover:bg-[#E2DFD8] hover:text-[#6F6B62]"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  )
}
