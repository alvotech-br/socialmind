'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiFetch } from '@/lib/api'

type User = {
  id: string
  name: string
  email: string
  locale: string
}

type AuthState = {
  user: User | null
  accessToken: string | null
  workspaceId: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ requires2FA?: boolean }>
  logout: () => Promise<void>
  setToken: (token: string) => void
  setWorkspace: (id: string) => void
  refresh: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      workspaceId: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const data = await apiFetch<{
            accessToken?: string
            user?: User
            requires2FA?: boolean
          }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
            credentials: 'include', // para receber cookie do refresh token
          })

          if (data.requires2FA) return { requires2FA: true }

          set({ accessToken: data.accessToken ?? null, user: data.user ?? null })
          return {}
        } finally {
          set({ isLoading: false })
        }
      },

      logout: async () => {
        const token = get().accessToken
        if (token) {
          await apiFetch('/auth/logout', {
            method: 'POST',
            token,
            credentials: 'include',
          }).catch(() => null)
        }
        set({ user: null, accessToken: null, workspaceId: null })
      },

      setToken: (token) => set({ accessToken: token }),

      setWorkspace: (id) => set({ workspaceId: id }),

      refresh: async () => {
        try {
          const data = await apiFetch<{ accessToken: string }>('/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          })
          set({ accessToken: data.accessToken })
          return true
        } catch {
          set({ user: null, accessToken: null })
          return false
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (s) => ({ user: s.user, workspaceId: s.workspaceId }),
      skipHydration: true,
    },
  ),
)
