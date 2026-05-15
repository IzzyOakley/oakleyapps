import type { Metadata } from 'next'
import { RefreshCw } from 'lucide-react'

export const metadata: Metadata = { title: 'MargO — Oakley Apps' }

export default function MargoPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center animate-in fade-in"
      style={{
        background: 'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(139, 92, 246, 0.04) 0%, transparent 100%)',
      }}
    >
      <RefreshCw size={48} className="text-secondary opacity-60" />
      <h1 className="text-xl font-semibold text-text-primary mt-4">MargO</h1>
      <p className="text-sm text-text-secondary mt-2">
        This app is in development and will be available soon.
      </p>
    </div>
  )
}
