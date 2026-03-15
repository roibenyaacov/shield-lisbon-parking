import { type HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  interactive?: boolean
}

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding = 'md', interactive, onClick, ...props }, ref) => {
    return (
      <div
        ref={ref}
        onClick={onClick}
        className={cn(
          'rounded-3xl border border-slate-200 bg-white transition-all duration-200',
          paddings[padding],
          interactive || onClick
            ? 'cursor-pointer hover:shadow-xl active:scale-[0.98]'
            : '',
          className
        )}
        style={{ boxShadow: 'var(--ios-shadow-lg)' }}
        {...props}
      />
    )
  }
)

Card.displayName = 'Card'
