import { cn } from '@/lib/utils'

const LOGO_SRC = {
  mark: '/brand/cdmaa-mark.png',
  full: '/brand/cdmaa-logo.png',
} as const

export interface AssociationLogoProps {
  variant?: keyof typeof LOGO_SRC
  className?: string
  alt?: string
}

/**
 * Association brand mark. `mark` is the compact emblem used in headers and
 * receipts; `full` includes the registered-name lines and is used on the
 * administrator sign-in screen.
 */
export function AssociationLogo({
  variant = 'mark',
  className,
  alt = 'Association logo',
}: AssociationLogoProps) {
  return (
    <img
      src={LOGO_SRC[variant]}
      alt={alt}
      className={cn('w-auto object-contain', className)}
      decoding="async"
    />
  )
}
