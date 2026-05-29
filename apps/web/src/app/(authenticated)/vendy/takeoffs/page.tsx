import type { Metadata } from 'next'
import TakeoffHubV2Client from './TakeoffHubV2Client'

export const metadata: Metadata = { title: 'Takeoffs — Vendy' }

export default function TakeoffsPage() {
  return <TakeoffHubV2Client />
}
