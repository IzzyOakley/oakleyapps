'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, RefreshCw, Shield, LogOut, Ruler, FileOutput, Building2 } from 'lucide-react'
import type { AuthUser, UserRole } from '@/types/auth'
import type { JSX } from 'react'

interface NavItem {
  href: string
  label: string
  icon: JSX.Element
  roles: UserRole[]
  indent?: boolean
  group?: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} />, roles: ['admin', 'management', 'pm', 'staff', 'vendor'], group: 'main' },
  { href: '/vendy/takeoffs', label: 'Takeoffs', icon: <Ruler size={16} />, roles: ['admin', 'management', 'pm'], group: 'projects' },
  { href: '/vendy/bids', label: 'Bids', icon: <FileOutput size={16} />, roles: ['admin', 'management', 'pm'], group: 'projects' },
  { href: '/vendy/vendors', label: 'Vendors', icon: <Building2 size={16} />, roles: ['admin', 'management', 'pm'], group: 'projects' },
  { href: '/margo', label: 'MargO', icon: <RefreshCw size={16} />, roles: ['admin', 'management', 'pm'], group: 'projects' },
  { href: '/admin', label: 'Admin', icon: <Shield size={16} />, roles: ['admin'], group: 'management' },
]

const GROUP_LABELS: Record<string, string> = {
  main: '',
  projects: 'Projects',
  management: 'Management',
}

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

  // Group items preserving order, showing a label only at the first item of each group
  const groups = visibleItems.reduce<{ group: string; items: NavItem[] }[]>((acc, item) => {
    const g = item.group ?? 'main'
    const last = acc[acc.length - 1]
    if (last && last.group === g) { last.items.push(item) }
    else { acc.push({ group: g, items: [item] }) }
    return acc
  }, [])

  async function handleSignOut() {
    await fetch('/api/auth/session', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 h-screen flex flex-col z-30 bg-sidebar border-r border-white/5" style={{ width: 172 }}>
      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
            <span className="text-white text-[11px] font-bold">V</span>
          </div>
          <div>
            <span className="text-[13px] font-semibold text-white">Oakley</span>
            <span className="text-[13px] font-semibold text-primary-mid"> Apps</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-4">
            {GROUP_LABELS[group] && (
              <p className="text-[9px] font-semibold uppercase tracking-widest text-white/20 mb-1.5 px-2">
                {GROUP_LABELS[group]}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map(item => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 ${
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
          </div>
        ))}
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
