import type { AuthUser } from '@/types/auth'
import SideNavClient from './SideNavClient'

interface Props {
  user: AuthUser
}

export default function SideNavServer({ user }: Props) {
  return <SideNavClient user={user} />
}
