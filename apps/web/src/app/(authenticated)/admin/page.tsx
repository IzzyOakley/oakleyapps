import type { Metadata } from 'next'
import Link from 'next/link'
import { Users, Shield } from 'lucide-react'

export const metadata: Metadata = { title: 'Admin — Oakley Apps' }

export default function AdminPage() {
  return (
    <div className="animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Admin</h1>
        <p className="text-sm text-text-secondary mt-1">Platform administration and configuration</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Link href="/admin/users" className="group block">
          <div className="bg-surface border border-border rounded-2xl p-6 transition-all duration-200 hover:border-border-bright hover:-translate-y-0.5 hover:shadow-glow">
            <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center text-primary">
              <Users size={22} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-text-primary">User Management</h2>
            <p className="mt-1 text-sm text-text-secondary">View all users, assign roles, and manage access.</p>
          </div>
        </Link>

        <div className="bg-surface border border-border rounded-2xl p-6 opacity-50">
          <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center text-primary">
            <Shield size={22} />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text-primary">Platform Settings</h2>
          <p className="mt-1 text-sm text-text-secondary">Coming in a future phase.</p>
        </div>
      </div>
    </div>
  )
}
