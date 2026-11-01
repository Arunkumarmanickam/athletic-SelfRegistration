# UI audit checklist

Run through this before marking a UI change complete.

## Global

- [ ] Header shows the full association name and "Self Registration Portal".
- [ ] Logo is sharp, transparent, and decorative where text names the group.
- [ ] One `h1` per page; heading order is sequential.
- [ ] Footer has organiser, contact details, policies, and copyright.
- [ ] No `orange-*` utilities remain in changed files.
- [ ] No hardcoded association name; `src/lib/brand.ts` is the source.

## Home

- [ ] Hero headline is legible at 360px without truncation.
- [ ] Primary CTA is obvious and reachable without scrolling.
- [ ] Nearest deadline is shown when a date exists.
- [ ] Trust strip (Regd. No., location, secure payment) is present.
- [ ] Championship cards show real status, not a hardcoded "Open".
- [ ] Empty and error states explain what to do next.

## Registration

- [ ] Progress indicator reflects the current step.
- [ ] Fee summary is visible before payment (sticky on desktop).
- [ ] Event picker shows eligibility reasons and the selection cap.
- [ ] First invalid field receives focus on submit.
- [ ] Inputs are 16px on mobile to avoid iOS zoom.
- [ ] Required fields are marked visually and with screen-reader text.

## Payment and confirmation

- [ ] Amount, currency, and itemisation match the server total.
- [ ] Pending, failed, and success states each have a clear next action.
- [ ] Receipt prints cleanly on A4 with chrome hidden.
- [ ] Bib number and athlete ID are easy to find.

## Status, returning, policies

- [ ] Lookup forms explain which identifier to use.
- [ ] Contact links use `mailto:` and `tel:`.
- [ ] Policy pages are readable at 16px with clear headings.

## Admin

- [ ] Active navigation is distinguishable without colour alone.
- [ ] Tables scroll horizontally on narrow screens.
- [ ] Filters and bulk actions are reachable by keyboard.
- [ ] Destructive actions require confirmation.

## Accessibility

- [ ] Tab order follows the visual order.
- [ ] Focus ring is visible on light and navy surfaces.
- [ ] Images have meaningful `alt` or `alt=""` when decorative.
- [ ] Text contrast meets WCAG AA (4.5:1 body, 3:1 large).
- [ ] Motion is disabled under `prefers-reduced-motion`.

## Performance

- [ ] Images are compressed and sized for their display box.
- [ ] No layout shift from late-loading fonts or images.
- [ ] `npm run build` passes and the bundle size has not jumped unexpectedly.
