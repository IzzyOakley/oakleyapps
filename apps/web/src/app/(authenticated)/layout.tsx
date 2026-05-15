import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase-admin'
import type { AuthUser } from '@/types/auth'
import SideNavServer from '@/components/SideNavServer'

async function getUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value
  if (!sessionCookie) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      name: decoded.name as string ?? decoded.email ?? '',
      photoURL: decoded.picture as string | undefined,
      role: ((decoded as Record<string, unknown>)['role'] as string ?? 'staff') as AuthUser['role'],
    }
  } catch {
    return null
  }
}

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen bg-background">
      <SideNavServer user={user} />
      <main className="flex-1 ml-60 px-8 py-7 max-w-[1280px] animate-in fade-in">
        {children}
      </main>
    </div>
  )
}
