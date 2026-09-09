import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  activeWorkstationId: string | null
  setUser: (user: User | null) => void
  setActiveWorkstation: (id: string | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      activeWorkstationId: null,
      setUser: (user) => set({ user }),
      setActiveWorkstation: (id) => set({ activeWorkstationId: id }),
      logout: () => set({ user: null, activeWorkstationId: null }),
    }),
    {
      name: 'v2v-auth',
      partialize: (state) => ({
        user: state.user,
        activeWorkstationId: state.activeWorkstationId,
      }),
    }
  )
)
