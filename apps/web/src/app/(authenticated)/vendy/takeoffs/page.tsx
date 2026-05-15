import type { Metadata } from 'next'
import TakeoffHubClient from './TakeoffHubClient'

export const metadata: Metadata = { title: 'Takeoffs — Vendy' }

export default function TakeoffsPage() {
  return <TakeoffHubClient />
}
