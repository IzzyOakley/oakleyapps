'use client'

import { signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider, getAuth } from 'firebase/auth'

export async function signInWithGoogle(): Promise<void> {
  const auth = getAuth()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ hd: 'oakleyhomebuilders.com' })

  const result = await signInWithPopup(auth, provider)
  const email = result.user.email ?? ''

  if (!email.endsWith('@oakleyhomebuilders.com')) {
    await firebaseSignOut(auth)
    throw new Error('Unauthorized domain')
  }

  const idToken = await result.user.getIdToken()

  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })

  if (!res.ok) {
    throw new Error('Failed to create session')
  }
}

export async function signOut(): Promise<void> {
  const auth = getAuth()
  await firebaseSignOut(auth)
  await fetch('/api/auth/session', { method: 'DELETE' })
  window.location.href = '/login'
}
