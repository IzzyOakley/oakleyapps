export type UserRole = 'admin' | 'management' | 'pm' | 'staff' | 'vendor'

export interface AuthUser {
  uid: string
  email: string
  name: string
  photoURL?: string
  role: UserRole
}

export interface SessionPayload {
  uid: string
  email: string
  name: string
  photoURL?: string
  role: UserRole
  iat: number
  exp: number
}
