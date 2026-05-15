export type UserRole = 'admin' | 'management' | 'pm' | 'staff' | 'vendor'

export interface AuthUser {
  uid: string
  email: string
  name: string
  photoURL?: string
  role: UserRole
}

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  '/dashboard': ['admin', 'management', 'pm', 'staff', 'vendor'],
  '/vendy': ['admin', 'management', 'pm'],
  '/margo': ['admin', 'management', 'pm'],
  '/admin': ['admin'],
}
