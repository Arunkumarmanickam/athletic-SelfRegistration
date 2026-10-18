import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SearchComboboxProps {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  /** Suggestions. An empty list turns this into a plain text input. */
  options: string[]
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
  /** How many matches to show at once (default 50). */
  maxVisible?: number
}

/**
 * A text input with a searchable suggestion list.
 *
 * A value that is not in the list is kept as typed — the organiser's or
 * athlete's own wording is never silently dropped — so this behaves as a
 * dropdown while still tolerating a missing or renamed entry.
 */
export function SearchCombobox({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
  className,
  maxVisible = 50,
}: SearchComboboxProps) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase()
    const list = query ? options.filter((option) => option.toLowerCase().includes(query)) : options
    return list.slice(0, maxVisible)
  }, [options, value, maxVisible])

  const active = Math.min(highlight, Math.max(matches.length - 1, 0))
  const exact = options.some((option) => option.toLowerCase() === value.trim().toLowerCase())

  // Close when the click lands anywhere else.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  // Keep the highlighted row inside the visible part of a long list.
  useEffect(() => {
    if (!open || !listRef.current) return
    const row = listRef.current.children[active] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (option: string) => {
    onChange(option)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      if (open && matches.length > 0) {
        event.preventDefault()
        choose(matches[active])
      }
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setHighlight(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          'h-11 w-full rounded-lg border bg-white px-3 pr-9 text-sm text-slate-900 shadow-sm transition-colors',
          'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100',
          invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-slate-500',
          className,
        )}
      />

      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={placeholder ?? 'Suggestions'}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">
              {value.trim()
                ? `No match — “${value.trim()}” will be used as entered.`
                : options.length === 0
                  ? 'Type the name.'
                  : 'Start typing to search.'}
            </li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option}
                role="option"
                aria-selected={index === active}
                // mousedown would blur the input before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={cn(
                  'cursor-pointer px-3 py-2',
                  index === active ? 'bg-orange-50 text-slate-900' : 'text-slate-700',
                )}
              >
                {option}
              </li>
            ))
          )}
        </ul>
      )}

      {!open && value.trim() && !exact && options.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          Using “{value.trim()}” as entered (not in the list).
        </p>
      )}
    </div>
  )
}
