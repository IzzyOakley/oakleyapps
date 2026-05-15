import type { UserRole } from './types'
import { ROUTE_PERMISSIONS } from './types'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  management: 'Management',
  pm: 'Project Manager',
  staff: 'Staff',
  vendor: 'Vendor',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-indigo-500/15 text-indigo-400',
  management: 'bg-violet-500/15 text-violet-400',
  pm: 'bg-blue-500/15 text-blue-400',
  staff: 'bg-slate-500/15 text-slate-400',
  vendor: 'bg-amber-500/15 text-amber-400',
}

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role
}

export function getRoleColor(role: string): string {
  return ROLE_COLORS[role as UserRole] ?? 'bg-slate-500/15 text-slate-400'
}

export function canAccessRoute(role: UserRole, path: string): boolean {
  for (const [route, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (path === route || path.startsWith(`${route}/`)) {
      return roles.includes(role)
    }
  }
  return true
}
