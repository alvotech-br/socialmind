'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'

export function StoreProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useAuthStore.persist.rehydrate()
  }, [])

  return <>{children}</>
}
