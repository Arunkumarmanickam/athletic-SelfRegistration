import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors',
        'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100',
        invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-slate-500',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export interface FieldProps {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, htmlFor, required, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
        {required && (
          <span className="ml-0.5 text-orange-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Helper that links a generated id to a field for label/aria purposes. */
export function useFieldId(prefix: string): string {
  const id = useId()
  return `${prefix}-${id}`
}
