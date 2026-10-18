export function normalizeMobile(value: string): string {
  const digits = value.replace(/[^\d+]/g, '')
  if (!digits) return ''
  return digits.startsWith('+') ? digits : `+${digits}`
}
