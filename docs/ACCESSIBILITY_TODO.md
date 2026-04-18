# Accessibility Backlog

All deferred warnings from Sprint 2 have now been resolved as part of the mobile
responsiveness + a11y pass.

## Summary — Post-Sprint 3 pass

| File | Status | Remaining |
|------|--------|-----------|
| `app/[schoolId]/assets/page.tsx` | Fixed | 0 jsx-a11y issues |
| `app/[schoolId]/playlists/page.tsx` | Fixed | 0 jsx-a11y issues |
| `app/[schoolId]/screens/page.tsx` | Fixed | 0 jsx-a11y issues |
| `app/[schoolId]/templates/page.tsx` | Fixed | 0 |
| `app/[schoolId]/settings/page.tsx` | Fixed | 0 |
| `app/player/page.tsx` | Fixed | 0 |

---

## What was fixed in this pass

### Modal content divs — `role="document"` removed
`screens/page.tsx` (Pair Screen modal), `playlists/page.tsx` (Asset Picker modal,
Publish modal) all carried a pattern of:

```jsx
<div role="dialog" aria-modal="true">
  <button className="absolute inset-0" onClick={close} />          {/* backdrop */}
  <div className="relative z-10" role="document"
       onClick={stopPropagation} onKeyDown={stopPropagation}>
    ...
  </div>
</div>
```

The backdrop `<button>` and the content `<div>` are siblings, so clicks inside
the content never bubble to the backdrop button. The `role="document"` +
stopPropagation handlers were redundant and generated
`no-noninteractive-element-interactions` warnings. Removed both.

### Drag-and-drop containers — `<ul>`/`<li>`
`assets/page.tsx` had three drag-and-drop containers using
`<div role="listitem">`. Converted each to a semantic `<ul>` + `<li>` list
(folder tiles, asset grid, asset list view). Kept the drag handlers on the
`<li>` and added a targeted `eslint-disable-next-line
jsx-a11y/no-noninteractive-element-interactions` on each — drag handlers on
list items is intentional UX and the a11y rule cannot distinguish it.

### `<img onLoad>` in asset grid
Added `eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions`
for the single `onLoad` handler that writes the resolution badge — lifecycle
handler, not a user-interaction handler.

### New: mobile responsive sidebar
- `components/layout/Sidebar.tsx` now renders as a fixed slide-in drawer on
  screens < `md`, with a backdrop `<button aria-label="Close navigation menu">`
  that closes on click, click-through, or Escape.
- `components/layout/TopToolbar.tsx` exposes a hamburger `<button
  aria-label="Open navigation menu">` shown only below `md`.
- State lives in `store/ui-store.ts` as `mobileSidebarOpen` +
  `setMobileSidebarOpen` / `toggleMobileSidebar`.
- Route changes close the drawer automatically.

### New: skip-to-content link
Added a visually-hidden `<a href="#main-content">Skip to main content</a>` at
the top of `DashboardLayout.tsx`; it becomes visible on focus and jumps to the
`<main id="main-content" tabIndex={-1}>` element.

### New: builder desktop-only notice
The `/templates/builder/*` fullscreen route now shows a
"Larger screen required" notice below `lg` (1024px). Existing builder layout is
unchanged above `lg`.

---

## Known out-of-scope issues (not blocking)

- `components/template-builder/BuilderZone.tsx` — `Props.onConfigChange` passed
  to `<WidgetPreview>` which does not yet declare that prop. Pre-existing
  uncommitted WIP in the builder; not part of this a11y pass. Builder is
  intentionally locked down for this sprint.
- Several React Compiler `incompatible-library` warnings on `react-hook-form`
  `watch()` and `useDroppable()`/`useSortable()` from `@dnd-kit` — these are
  intentional dependencies, not a11y issues.

---

**Last Updated:** 2026-04-16 — post responsive + a11y cleanup pass
