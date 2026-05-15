import * as React from 'react'
import { cn } from './utils'

interface Breadcrumb {
  label: string
  href?: string
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  breadcrumbs?: Breadcrumb[]
  action?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, breadcrumbs, action, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 mb-3 text-xs text-text-muted">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span>/</span>}
              {crumb.href ? (
                <a href={crumb.href} className="hover:text-text-secondary transition-colors">{crumb.label}</a>
              ) : (
                <span>{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
