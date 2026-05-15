'use client'

import { useState, useEffect } from 'react'
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth'
import type { UserRole } from './types'

interface AuthState {
  user: User | null
  role: UserRole | null
  loading: boolean
  error: string | null
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const auth = getAuth()
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, role: null, loading: false, error: null })
        return
      }
      try {
        const token = await user.getIdTokenResult()
        const role = (token.claims['role'] as UserRole) ?? 'staff'
        setState({ user, role, loading: false, error: null })
      } catch {
        setState({ user, role: 'staff', loading: false, error: null })
      }
    }, (error) => {
      setState({ user: null, role: null, loading: false, error: error.message })
    })

    return unsub
  }, [])

  return state
}
