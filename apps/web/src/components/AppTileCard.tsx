'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface AppDef {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  status: 'active' | 'coming-soon'
}

export default function AppTileCard({ app }: { app: AppDef }) {
  return (
    <Link href={app.href} className="group block">
      <div className="bg-surface border border-border rounded-2xl p-6 transition-all duration-200 cursor-pointer hover:border-border-bright hover:-translate-y-0.5 hover:shadow-glow">
        <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center text-primary">
          {app.icon}
        </div>

        <h2 className="mt-4 text-lg font-semibold text-text-primary">{app.title}</h2>
        <p className="mt-1 text-sm text-text-secondary line-clamp-2">{app.description}</p>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          {app.status === 'active' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              Coming Soon
            </span>
          )}
          <ChevronRight size={16} className="text-text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}
