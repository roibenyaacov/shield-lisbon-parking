'use client'

import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, fullWidth, children, disabled, onClick, ...props }, ref) => {
    const variants = {
      primary: 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700 hover:shadow-xl',
      secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
      ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
      danger: 'bg-red-600 text-white shadow-lg shadow-red-600/30 hover:bg-red-700',
    }

    const sizes = {
      sm: 'h-9 px-4 text-sm',
      md: 'h-11 px-6 text-sm',
      lg: 'h-13 px-8 text-base py-4',
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (navigator.vibrate) navigator.vibrate(10)
      onClick?.(e)
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        onClick={handleClick}
        className={cn(
          'inline-flex items-center justify-center rounded-2xl font-semibold transition-all duration-200 active:scale-[0.98] focus:outline-none disabled:pointer-events-none disabled:opacity-50 haptic-feedback touch-manipulation',
          variants[variant],
          sizes[size],
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </>
        ) : (
          children
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
