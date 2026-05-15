import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from './utils'

type AppStatus = 'active' | 'coming-soon'

interface AppTileProps {
  title: string
  description: string
  icon: React.ReactNode
  status: AppStatus
  href: string
  className?: string
}

export function AppTile({ title, description, icon, status, href, className }: AppTileProps) {
  return (
    <a href={href} className={cn('group block', className)}>
      <div className="bg-surface border border-border rounded-2xl p-6 transition-all duration-200 cursor-pointer hover:border-border-bright hover:-translate-y-0.5 hover:shadow-glow">
        <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center text-primary">
          {icon}
        </div>

        <h2 className="mt-4 text-lg font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-sm text-text-secondary line-clamp-2">{description}</p>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          {status === 'active' ? (
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
          <ChevronRight
            size={16}
            className="text-text-muted transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </div>
      </div>
    </a>
  )
}
