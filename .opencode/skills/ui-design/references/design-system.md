# Design system reference

## Colour tokens

Defined in `src/index.css` under `@theme`. Tailwind generates utilities such as
`bg-brand-700`, `text-accent-600`, `ring-brand-200`.

| Token | Hex | Use |
| --- | --- | --- |
| `brand-50` | `#f2f3fa` | tinted panels, icon tiles |
| `brand-100` | `#e6e8f5` | borders on tinted panels |
| `brand-200` | `#cbcfeb` | subtle dividers on dark |
| `brand-300` | `#a6acdb` | muted text on navy |
| `brand-400` | `#7f87c7` | icons on navy |
| `brand-500` | `#626bb3` | focus ring, secondary emphasis |
| `brand-600` | `#4d5299` | hover for primary |
| `brand-700` | `#404080` | primary buttons, links |
| `brand-800` | `#36366a` | primary hover |
| `brand-900` | `#2b2b57` | hero and footer panels |
| `brand-950` | `#1b1b38` | deepest background |
| `accent-50` | `#fef3f2` | deadline chips |
| `accent-100` | `#fde3e1` | selected chips |
| `accent-200` | `#fbc9c5` | chip border |
| `accent-300` | `#f7a29c` | accent on navy |
| `accent-400` | `#f06b62` | accent on navy hover |
| `accent-500` | `#e02020` | primary CTA |
| `accent-600` | `#c81a1a` | CTA hover, eyebrows |
| `accent-700` | `#a81616` | text links |
| `accent-800` | `#8b1717` | deadline text |
| `accent-900` | `#741919` | darkest accent text |
| `surface` | `#f7f8fb` | page background |

Neutrals stay on Tailwind `slate`. Status stays on `emerald` / `amber` /
`sky` / `red` so it is never confused with the brand accent.

## Typography

- Body: `font-sans` (Inter), base 16px on public pages.
- Display: `font-display` (Archivo 600-800) for public `h1` / `h2`.
- Scale: `text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg` 18,
  `text-2xl` 24, `text-3xl` 30, `text-4xl` 36, `text-5xl` 48, `text-6xl` 60.
- Eyebrows: `text-xs font-semibold uppercase tracking-[0.14em]`.

## Spacing and shape

- Section: `py-12` mobile, `py-16` desktop.
- Card: `rounded-xl border border-slate-200 bg-white shadow-sm`, padding `p-5`.
- Hero panel: `rounded-2xl`, inner card `rounded-xl`.
- Buttons: `rounded-lg`, height 36 / 44 / 48.
- Inputs: `h-11`, `rounded-lg`, 16px text on mobile (prevents iOS zoom).

## Component recipes

### Primary button

`bg-brand-700 text-white hover:bg-brand-800`

### Accent button (one per screen)

`bg-accent-500 text-white hover:bg-accent-600`

### Inverse button (on navy)

`border border-white/30 bg-white/5 text-white hover:bg-white/15`

### Status badge

Pair tone with text: `Open` (success), `Closing soon` (warning),
`Closed` (neutral). Never rely on the dot alone.

### Deadline chip

`inline-flex items-center gap-2 rounded-lg bg-accent-50 px-3 py-2 text-sm
font-medium text-accent-800 ring-1 ring-inset ring-accent-200`

### Icon tile

`flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700
ring-1 ring-inset ring-brand-100`

## Do not

- Use `orange-*`; it is legacy and clashes with the logo.
- Use red for ordinary body text or large surfaces.
- Add a second display font.
- Hardcode `Coimbatore District Masters Athletic Association`; import it.
- Use colour alone to communicate status.
