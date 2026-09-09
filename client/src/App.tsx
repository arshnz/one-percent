import { useEffect, useState, lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { Toaster } from 'react-hot-toast'
import { Layout } from '@/components/layout/Layout'
import { useAuthStore } from '@/stores/auth'
import { auth as firebaseAuth } from '@/lib/firebase'
import { auth as authApi, workstations as wsApi } from '@/lib/api'
import { LandingPage } from '@/pages/Landing'
import { AuthPage } from '@/pages/Auth'
import { PrivacyPage } from '@/pages/Privacy'
import { LaunchpadPage } from '@/pages/Launchpad'
import { MomentumPage } from '@/pages/Momentum'

// Reload once on a chunk-load failure (stale index.html after a new deploy),
// then re-throw. Shared by every lazy route below.
function lazyWithReload<T extends { default: React.ComponentType<any> }>(
  importer: () => Promise<T>
) {
  return lazy(() =>
    importer().catch((err) => {
      if (!sessionStorage.getItem('chunk_reloaded')) {
        sessionStorage.setItem('chunk_reloaded', 'true')
        window.location.reload()
      }
      throw err
    })
  )
}

// Code-split the heavier, less-frequently-opened routes so the daily Launchpad
// loop ships a smaller main bundle. Canvas pulls in @xyflow/react; Coach pulls
// in the markdown renderer; Architect/Settings are large forms.
const HabitCoachPage = lazyWithReload(() => import('@/pages/HabitCoach').then((m) => ({ default: m.HabitCoachPage })))
const VisionCanvasPage = lazyWithReload(() => import('@/pages/VisionCanvas').then((m) => ({ default: m.VisionCanvasPage })))
const ArchitectPage = lazyWithReload(() => import('@/pages/Architect').then((m) => ({ default: m.ArchitectPage })))
const SettingsPage = lazyWithReload(() => import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })))
const CompassPage = lazyWithReload(() => import('@/pages/Compass').then((m) => ({ default: m.CompassPage })))
const TheoryPage = lazyWithReload(() => import('@/pages/Theory').then((m) => ({ default: m.TheoryPage })))
const CheckInPage = lazyWithReload(() => import('@/pages/CheckIn').then((m) => ({ default: m.CheckInPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

const persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'v2v-query-cache',
})

function RouteFallback() {
  return (
    <div className="flex justify-center py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#B8714C] border-t-transparent" />
    </div>
  )
}

// Verifies the Firebase session, syncs the Prisma user, and ensures an active
// habit container is selected before rendering authed routes.
function AuthGuard() {
  const { user, setUser, activeWorkstationId, setActiveWorkstation } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    firebaseAuth.authStateReady().then(async () => {
      if (!firebaseAuth.currentUser) {
        setUser(null)
        setLoading(false)
        navigate('/auth', { replace: true })
        return
      }
      try {
        // sync() upserts the Prisma user AND returns the full user row, so a
        // separate me() round-trip is unnecessary. sync() and the workstation
        // list are independent — fire them in parallel.
        const [{ user: u }, { workstations }] = await Promise.all([
          authApi.sync(),
          wsApi.list(),
        ])
        setUser(u)
        // Always reconcile the active workstation against THIS user's own
        // workstations. A persisted id from a previous account would otherwise
        // trigger "Workstation not found" on every write.
        const stillValid = activeWorkstationId && workstations.some((w) => w.id === activeWorkstationId)
        if (!stillValid) setActiveWorkstation(workstations[0]?.id ?? null)
      } catch {
        setUser(null)
        navigate('/auth', { replace: true })
      } finally {
        setLoading(false)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-bg">
        <span className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!user) return null
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/auth', element: <AuthPage /> },
  // Public and unauthenticated — App Store Connect requires a reachable
  // privacy policy URL, and reviewers open it.
  { path: '/privacy', element: <PrivacyPage /> },
  {
    path: '/app',
    element: <AuthGuard />,
    children: [
      {
        element: (
          <Layout>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </Layout>
        ),
        children: [
          { index: true, element: <LaunchpadPage /> },
          { path: 'architect', element: <ArchitectPage /> },
          { path: 'architect/:id', element: <ArchitectPage /> },
          { path: 'coach', element: <HabitCoachPage /> },
          { path: 'compass', element: <CompassPage /> },
          { path: 'momentum', element: <MomentumPage /> },
          // The reminder nudges deep-link here; also the way back into a week
          // that was skipped from the Launchpad card.
          { path: 'checkin', element: <CheckInPage /> },
          // Ledger was renamed to Momentum — keep old bookmarks working.
          { path: 'ledger', element: <Navigate to="/app/momentum" replace /> },
          // /app/today never existed as a route, but reminder emails, the PWA
          // manifest and push payloads all pointed here for months — those are
          // already out in the world and can't be recalled. Land them properly.
          { path: 'today', element: <Navigate to="/app" replace /> },
          { path: 'theory', element: <TheoryPage /> },
          { path: 'canvas', element: <VisionCanvasPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, buster: 'v4', maxAge: 24 * 60 * 60_000 }}
    >
      <RouterProvider router={router} />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: { background: 'rgb(30 28 24)', color: 'rgb(249 248 245)', fontSize: '13px', borderRadius: '10px' },
        }}
      />
    </PersistQueryClientProvider>
  )
}
