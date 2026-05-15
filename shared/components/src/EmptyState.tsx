import * as React from 'react'
import { cn } from './utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16', className)}>
      {icon && (
        <div className="text-primary opacity-60 mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-semibold text-text-primary">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary mt-2 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
