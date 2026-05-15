'use client'

import * as React from 'react'
import { cn } from './utils'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  section?: string
}

interface UserInfo {
  name: string
  role: string
  photoURL?: string
  avatarFallback: string
}

interface SideNavProps {
  items: NavItem[]
  currentPath: string
  user: UserInfo
  onSignOut?: () => void
  className?: string
}

export function SideNav({ items, currentPath, user, onSignOut, className }: SideNavProps) {
  const sections = Array.from(new Set(items.map(i => i.section ?? '')))

  return (
    <aside
      className={cn('fixed left-0 top-0 h-screen w-60 flex flex-col z-30 border-r border-border', className)}
      style={{ background: '#07070D' }}
    >
      <div className="px-5 py-5 border-b border-border">
        <span className="text-lg font-semibold text-text-primary">Oakley</span>
        <span className="text-lg font-semibold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"> Apps</span>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {sections.map(section => {
          const sectionItems = items.filter(i => (i.section ?? '') === section)
          return (
            <div key={section}>
              {section && (
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted mt-4 mb-2 px-3">
                  {section}
                </p>
              )}
              <ul className="space-y-0.5">
                {sectionItems.map(item => {
                  const isActive = currentPath === item.href || currentPath.startsWith(`${item.href}/`)
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150',
                          isActive
                            ? 'text-text-primary bg-surface-raised border-l-2 border-primary pl-[10px]'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface',
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          {user.photoURL ? (
            <img src={user.photoURL} alt={user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-primary">{user.avatarFallback}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
            <p className="text-xs text-text-muted">{user.role}</p>
          </div>
          {onSignOut && (
            <button onClick={onSignOut} className="text-text-muted hover:text-text-secondary transition-colors shrink-0 text-xs">
              Out
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
