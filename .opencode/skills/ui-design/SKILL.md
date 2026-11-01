---
name: CDMAA UI Design
description: Use when designing or changing UI in this athlete registration portal — pages, components, layout, colour, typography, forms, tables, responsive behaviour, or accessibility.
---

# CDMAA UI Design

## Product

Self-registration portal for Coimbatore District Masters Athletic Association.
Users are masters athletes (35+), often on phones, sometimes with low digital
confidence. Optimise for trust, clarity, and completing registration.

## Brand

- Navy/indigo (from the logo): `#2b2b57` strong, `#404080` primary, `#626bb3` mid.
- Red (from the logo): `#e02020` accent, `#c81a1a` hover. Use sparingly: CTA,
  deadlines, required marks.
- Surface `#f7f8fb`, card `#ffffff`, border `#e2e8f0`.
- Text `#0f172a` primary, `#475569` secondary.
- Tailwind tokens live in `src/index.css` under `@theme`: `brand-*` and
  `accent-*`. Use those classes. Do not introduce new accent colours.
- Names come from `src/lib/brand.ts`. Never hardcode the association name.
- Logo: `src/components/AssociationLogo.tsx`. Use `alt=""` when adjacent text
  already names the association.
- The brand lockup mirrors the client's logo: emblem, association name,
  "Self Registration Portal", then `Regd. No. 256/97 · Coimbatore`
  (`ASSOCIATION_CREDENTIALS`). Keep all three text lines together; they are the
  association's official identification, not decoration.

## Typography

- Inter for body and UI. Archivo (`font-display`) for public page headings.
- Public body text >= 16px. Only legal/meta text may go below 12px.
- Headings: tight leading (`leading-tight`), at most two lines on mobile.
- Use `text-balance` on hero and section headings.

## Layout

- Public container `max-w-6xl`; reading width `max-w-2xl`.
- Mobile-first: single column below 640px; tap targets >= 44px.
- Section spacing `py-12` / `py-16`; card padding `p-5` / `p-6`.
- Registration flow: sticky primary action and visible progress.

## Components

- Reuse `src/components/ui/*`: Button, Card, Badge, Alert, Spinner,
  EmptyState, Field/Input, Table, Dialog.
- Add variants in the component file. Do not fork one-off styles in pages.
- Status is never colour-only: pair the badge with text or an icon.
- Use lucide-react for icons (already installed); 16/20px, stroke 1.75.

## Forms (critical path)

- One question per row on mobile; labels above inputs; mark required fields.
- Inline error text with `aria-describedby`; focus the first invalid field.
- Show progress: Details -> Events -> Payment -> Review.
- Event picker: eligible first, ineligible disabled with a visible reason,
  selected chips sticky, enforce the cap with a clear message.
- Fee summary always visible before payment; itemised; sticky on desktop.

## Accessibility

- WCAG 2.1 AA contrast, keyboard operable, visible focus.
- Semantic landmarks; one `h1` per page; meaningful or empty alt text.
- Respect `prefers-reduced-motion`.

## Quality bar before finishing

1. `npm run build` passes.
2. Check 360px, 768px, and 1280px widths.
3. Tab through the changed flow; no focus traps.
4. No hardcoded brand strings, off-token colours, or duplicated components.
5. Summarise what changed and list follow-ups.

## References

- `references/design-system.md` — tokens, spacing, component recipes.
- `references/audit-checklist.md` — page-by-page review checklist.
