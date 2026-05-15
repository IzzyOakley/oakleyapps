'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { FileText, RefreshCw, Shield } from 'lucide-react'
import type { AuthUser, UserRole } from '@/types/auth'
import AppTileCard from '@/components/AppTileCard'
import { Suspense } from 'react'

interface AppDef {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  status: 'active' | 'coming-soon'
  roles: UserRole[]
}

const APPS: AppDef[] = [
  {
    id: 'vendy',
    title: 'Vendy',
    description: 'Automated bid packaging and vendor communication for every project phase.',
    icon: <FileText size={22} />,
    href: '/vendy',
    status: 'active',
    roles: ['admin', 'management', 'pm'],
  },
  {
    id: 'margo',
    title: 'MargO',
    description: 'AI-powered change order pricing with margin tracking and approval workflows.',
    icon: <RefreshCw size={22} />,
    href: '/margo',
    status: 'coming-soon',
    roles: ['admin', 'management', 'pm'],
  },
  {
    id: 'admin',
    title: 'Admin',
    description: 'Platform administration — user management, roles, and configuration.',
    icon: <Shield size={22} />,
    href: '/admin',
    status: 'active',
    roles: ['admin'],
  },
]

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  management: 'Management',
  pm: 'Project Manager',
  staff: 'Staff',
  vendor: 'Vendor',
}

interface Props {
  user: AuthUser | null
}

function DashboardInner({ user }: Props) {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  useEffect(() => {
    if (error === 'unauthorized') {
      // Toast would appear here — using alert as fallback until Toast component wired
      console.warn('You do not have permission to access that page.')
    }
  }, [error])

  const visibleApps = APPS.filter(app => user && app.roles.includes(user.role))
  const firstName = user?.name?.split(' ')[0] ?? 'there'

  return (
    <div className="animate-in fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">
          {getGreeting()}, {firstName}
          {user && (
            <span className="text-text-muted"> · {ROLE_LABELS[user.role]}</span>
          )}
        </p>
      </div>

      {visibleApps.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-8">
          {visibleApps.map(app => (
            <AppTileCard key={app.id} app={app} />
          ))}
        </div>
      ) : (
        <div className="mt-16 text-center">
          <p className="text-text-secondary text-sm">No apps are available for your role yet.</p>
        </div>
      )}
    </div>
  )
}

export default function DashboardClient({ user }: Props) {
  return (
    <Suspense>
      <DashboardInner user={user} />
    </Suspense>
  )
}
