'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, FileText, RefreshCw, Shield, LogOut, Ruler, FileOutput } from 'lucide-react'
import type { AuthUser, UserRole } from '@/types/auth'
import type { JSX } from 'react'

interface NavItem {
  href: string
  label: string
  icon: JSX.Element
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
    <aside className="fixed left-0 top-0 h-screen w-60 flex flex-col z-30 bg-sidebar border-r border-white/5">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">V</span>
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Oakley</span>
            <span className="text-sm font-semibold text-primary-mid"> Apps</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/20 mt-2 mb-2 px-2">Apps</p>
        <ul className="space-y-0.5">
          {visibleItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 ${
                    item.indent ? 'ml-5' : ''
                  } ${
                    isActive
                      ? 'text-nav-active bg-sidebar-active rounded-r-md border-l-2 border-primary pl-[9px]'
                      : 'text-nav-inactive rounded-md hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <span className={isActive ? 'text-nav-active' : 'text-nav-inactive'}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="px-3 py-4 border-t border-white/5">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <UserAvatar user={user} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-white/80 truncate">{user.name}</p>
            <p className="text-[10px] text-nav-inactive">{ROLE_LABELS[user.role]}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-nav-inactive hover:text-white/60 transition-colors duration-150 shrink-0"
            title="Sign out"
          >
            <LogOut size={14} />
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
