import * as React from 'react'
import { cn } from './utils'

type UserRole = 'admin' | 'management' | 'pm' | 'staff' | 'vendor'

const ROLE_STYLES: Record<UserRole, string> = {
  admin: 'bg-indigo-500/15 text-indigo-400',
  management: 'bg-violet-500/15 text-violet-400',
  pm: 'bg-blue-500/15 text-blue-400',
  staff: 'bg-slate-500/15 text-slate-400',
  vendor: 'bg-amber-500/15 text-amber-400',
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  management: 'Management',
  pm: 'Project Manager',
  staff: 'Staff',
  vendor: 'Vendor',
}

interface RoleBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  role: UserRole
  showLabel?: boolean
}

export function RoleBadge({ role, showLabel = true, className, ...props }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        ROLE_STYLES[role],
        className,
      )}
      {...props}
    >
      {showLabel ? ROLE_LABELS[role] : role}
    </span>
  )
}

export { ROLE_LABELS, ROLE_STYLES }
export type { UserRole }
