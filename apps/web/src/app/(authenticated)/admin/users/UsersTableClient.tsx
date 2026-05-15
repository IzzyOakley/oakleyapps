'use client'

import { useState } from 'react'
import type { UserRole } from '@/types/auth'

interface UserRow {
  uid: string
  email: string
  name: string
  photoURL?: string
  role: UserRole
  lastLogin: string | null
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Administrator' },
  { value: 'management', label: 'Management' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'staff', label: 'Staff' },
  { value: 'vendor', label: 'Vendor' },
]

const ROLE_STYLES: Record<UserRole, string> = {
  admin: 'bg-indigo-500/15 text-indigo-400',
  management: 'bg-violet-500/15 text-violet-400',
  pm: 'bg-blue-500/15 text-blue-400',
  staff: 'bg-slate-500/15 text-slate-400',
  vendor: 'bg-amber-500/15 text-amber-400',
}

interface Props {
  initialUsers: UserRow[]
}

export default function UsersTableClient({ initialUsers }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleRoleChange(uid: string, newRole: UserRole) {
    setSavingUid(uid)
    try {
      const res = await fetch('/api/admin/set-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, role: newRole }),
      })
      if (!res.ok) throw new Error('Failed')
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u))
      showToast('Role updated', 'success')
    } catch {
      showToast('Failed to update role', 'error')
    } finally {
      setSavingUid(null)
    }
  }

  return (
    <div className="relative">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all animate-in fade-in ${
          toast.type === 'success'
            ? 'bg-success/15 text-success border border-success/20'
            : 'bg-error/15 text-error border border-error/20'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-raised border-b border-border">
              <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">User</th>
              <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">Role</th>
              <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-muted hidden md:table-cell">Last Login</th>
              <th className="text-right px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">No users found</td>
              </tr>
            )}
            {users.map(user => (
              <tr key={user.uid} className="border-t border-border hover:bg-surface-raised/50 transition-colors duration-100">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={user} />
                    <div>
                      <p className="font-medium text-text-primary">{user.name}</p>
                      <p className="text-xs text-text-muted">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[user.role]}`}>
                    {ROLES.find(r => r.value === user.role)?.label ?? user.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-text-muted hidden md:table-cell">
                  {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <select
                    value={user.role}
                    disabled={savingUid === user.uid}
                    onChange={e => handleRoleChange(user.uid, e.target.value as UserRole)}
                    className="bg-surface-raised border border-border text-text-secondary text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                  >
                    {ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UserAvatar({ user }: { user: UserRow }) {
  const initials = user.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
  if (user.photoURL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.photoURL} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
  }
  return (
    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
      <span className="text-xs font-medium text-primary">{initials}</span>
    </div>
  )
}
