import * as React from 'react'
import { cn } from './utils'

interface UserAvatarProps {
  name: string
  photoURL?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
}

export function UserAvatar({ name, photoURL, size = 'md', className }: UserAvatarProps) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name}
        className={cn('rounded-full object-cover', sizeStyles[size], className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-full bg-primary/20 flex items-center justify-center font-medium text-primary',
        sizeStyles[size],
        className,
      )}
    >
      {initials}
    </div>
  )
}
