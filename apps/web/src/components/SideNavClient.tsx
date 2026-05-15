'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, FileText, RefreshCw, Shield, LogOut, Ruler, FileOutput } from 'lucide-react'
import type { AuthUser, UserRole } from '@/types/auth'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  roles: UserRole[]
  indent?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, roles: ['admin', 'management', 'pm', 'staff', 'vendor'] },
  { href: '/vendy', label: 'Vendy', icon: <FileText size={20} />, roles: ['admin', 'management', 'pm'] },
  { href: '/vendy/takeoffs', label: 'Takeoffs', icon: <Ruler size={16} />, roles: ['admin', 'management', 'pm'], indent: true },
  { href: '/vendy/bids', label: 'Bids', icon: <FileOutput size={16} />, roles: ['admin', 'management', 'pm'], indent: true },
  { href: '/margo', label: 'MargO', icon: <RefreshCw size={20} />, roles: ['admin', 'management', 'pm'] },
  { href: '/admin', label: 'Admin', icon: <Shield size={20} />, roles: ['admin'] },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  management: 'Management',
  pm: 'Project Manager',
  staff: 'Staff',
  vendor: 'Vendor',
}

interface Props {
  user: AuthUser
}

export default function SideNavClient({ user }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(user.role))

  async function handleSignOut() {
    await fetch('/api/auth/session', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 flex flex-col z-30 border-r border-border"
      style={{ background: '#07070D' }}
    >
      <div className="px-5 py-5 border-b border-border">
        <span className="text-lg font-semibold text-text-primary">Oakley</span>
        <span className="text-lg font-semibold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"> Apps</span>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted mt-2 mb-2 px-3">Apps</p>
        <ul className="space-y-0.5">
          {visibleItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                    item.indent ? 'ml-4' : ''
                  } ${
                    isActive
                      ? 'text-text-primary bg-surface-raised border-l-2 border-primary pl-[10px]'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <UserAvatar user={user} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
            <p className="text-xs text-text-muted">{ROLE_LABELS[user.role]}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-text-muted hover:text-text-secondary transition-colors duration-150 shrink-0"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function UserAvatar({ user }: { user: AuthUser }) {
  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  if (user.photoURL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.photoURL} alt={user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
  }

  return (
    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
      <span className="text-xs font-medium text-primary">{initials}</span>
    </div>
  )
}
