import type { Metadata } from 'next'
import { adminAuth } from '@/lib/firebase-admin'
import type { UserRole } from '@/types/auth'
import UsersTableClient from './UsersTableClient'

export const metadata: Metadata = { title: 'Users — Oakley Apps' }

interface FirebaseUser {
  uid: string
  email?: string
  displayName?: string
  photoURL?: string
  metadata: { lastSignInTime?: string }
  customClaims?: Record<string, unknown>
}

async function getUsers() {
  try {
    const result = await adminAuth.listUsers(100)
    return result.users.map((u: FirebaseUser) => ({
      uid: u.uid,
      email: u.email ?? '',
      name: u.displayName ?? u.email ?? '',
      photoURL: u.photoURL,
      role: (u.customClaims?.['role'] as UserRole) ?? 'staff',
      lastLogin: u.metadata.lastSignInTime ?? null,
    }))
  } catch {
    return []
  }
}

export default async function UsersPage() {
  const users = await getUsers()
  return (
    <div className="animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Users</h1>
        <p className="text-sm text-text-secondary mt-1">{users.length} member{users.length !== 1 ? 's' : ''}</p>
      </div>
      <UsersTableClient initialUsers={users} />
    </div>
  )
}
