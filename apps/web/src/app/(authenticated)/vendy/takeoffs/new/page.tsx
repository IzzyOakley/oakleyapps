import type { Metadata } from 'next'
import StartNewProjectClient from './StartNewProjectClient'

export const metadata: Metadata = { title: 'New Project — Takeoffs — Vendy' }

export default function NewProjectPage() {
  return <StartNewProjectClient />
}
