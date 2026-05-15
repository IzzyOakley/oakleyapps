import * as React from 'react'
import { cn } from './utils'

interface LoadingSpinnerProps {
  fullPage?: boolean
  className?: string
}

export function LoadingSpinner({ fullPage, className }: LoadingSpinnerProps) {
  const spinner = (
    <div className={cn('w-8 h-8 border-2 border-surface-raised border-t-primary rounded-full animate-spin', className)} />
  )

  if (fullPage) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        {spinner}
      </div>
    )
  }

  return spinner
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface-raised rounded-lg animate-pulse', className)} />
  )
}
