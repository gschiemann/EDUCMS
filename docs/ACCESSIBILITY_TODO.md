# Accessibility Sprint 2 Backlog

Sprint 2 fixes completed. All violations from the original queue have been resolved or narrowed.

## Summary — Post-Sprint 2

| File | Status | Remaining |
|------|--------|-----------|
| `app/[schoolId]/assets/page.tsx` | Fixed | 4 warnings (drag-target `role="listitem"` divs — `no-noninteractive-element-interactions` warn-level, drag & drop is intentional) |
| `app/[schoolId]/playlists/page.tsx` | Fixed | 2 warnings (modal content `role="document"` divs with `onKeyDown` stopPropagation — warn-level) |
| `app/[schoolId]/screens/page.tsx` | Fixed | 1 warning (modal content `role="document"` div — warn-level) |
| `app/[schoolId]/templates/page.tsx` | Fixed (eslint-disable removed) | 0 — no jsx-a11y violations |
| `app/[schoolId]/settings/page.tsx` | Fixed | 0 |
| `app/player/page.tsx` | Fixed | 0 |

Total resolved: ~120 violations across 6 files.
Remaining deferred (warn-level only): 7 warnings — all `no-noninteractive-element-interactions` on drag-and-drop containers and modal content divs.

---

## What was fixed

### `app/[schoolId]/settings/page.tsx`
- Replaced `autoFocus` on invite email input with `useRef` + `useEffect`-based focus when `showAddUser` opens.

### `app/[schoolId]/assets/page.tsx`
- Removed top-of-file `eslint-disable` block.
- Replaced `autoFocus` on URL form and new-folder inputs with `useEffect`-based focus.
- Drop-zone `<div onClick>`: added `role="button"`, `tabIndex={0}`, `aria-label`, and `onKeyDown` (Enter/Space).
- Folder tiles: outer drag-target div gets `role="listitem"`; inner open-folder action converted to `<button>`.
- Folder context menu: converted to `role="none"` div with `onKeyDown` stopPropagation.
- Asset grid cards: selection checkbox `<div onClick>` → `<button aria-pressed>`; detail-open action wrapped in `<button>`.
- Asset list rows: same pattern — selection and detail-open converted to `<button>`.
- Detail panel backdrop: `<div onClick>` → `<button aria-label="Close detail panel">`.

### `app/[schoolId]/screens/page.tsx`
- Removed top-of-file `eslint-disable` block.
- Replaced `autoFocus` on new-group, pair-code, and inline-rename inputs with `useRef`/`useEffect`.
- Screen name `<p onClick>` to start rename → `<button>` with `title`.
- Pair modal: backdrop `<div onClick>` → `<button aria-label="Close dialog">` + inner content gets `role="document"` + `onKeyDown` stopPropagation.
- Pair modal labels: added `htmlFor`/`id` pairs for Pairing Code, Screen Name, and Assign to Group fields.

### `app/[schoolId]/playlists/page.tsx`
- Removed top-of-file `eslint-disable` block.
- `PlaylistCard`: outer `<div onClick>` refactored — full-coverage `<button>` overlay for open action; delete `<div onClick>` → `<button>`.
- Asset picker asset tiles: `<div onClick>` → `<button aria-pressed>` with `aria-label`.
- Asset picker and publish modals: backdrop `<button>` + inner content `role="document"` + `onKeyDown` stopPropagation.
- `SortableItem` settings panel: bare `<label>` elements without associated controls fixed — time-start/time-end inputs get `id={...item.id}`; transition select gets `id`; header `<label>` elements converted to `<p>` where no control association was possible.
- Publish modal section headers: bare `<label>` elements (Publish Targets, When to Play, Conflict Resolution, Days of Week) converted to `<p>` since they label groups of buttons, not a single input. Time window inputs get `id` + `<label htmlFor>`.
- Replaced `autoFocus` on both playlist name inputs (blank and template modes) with a shared `createNameInputRef` + `useEffect`.

### `app/player/page.tsx`
- Removed top-of-file `eslint-disable` block.
- Template overlay root `<div onClick>` and media playlist root `<div onClick>`: added `role="button"`, `tabIndex={0}`, `aria-label`, and `onKeyDown` (Enter/Space).
- "No content" waiting screen inner `<div onClick stopPropagation>`: added `role="presentation"`.

---

## Remaining deferred items (out of scope for Sprint 2)

### `components/template-builder/BuilderShell.tsx` — DO NOT TOUCH
- **lines 307, 315**: `jsx-a11y/click-events-have-key-events` + `no-static-element-interactions` errors.
- These are in the template-builder directory which is under active development (main thread building it). Deferred to Sprint 3.

### Drag-and-drop containers (warn-level, not errors)
- `assets/page.tsx` lines 383, 461, 494, 533: `role="listitem"` divs with `onDragOver`/`onDrop` trigger `no-noninteractive-element-interactions` warning. Drag-and-drop is intentional UX. To fix cleanly: wrap each in a `<ul>` parent and use `role="listitem"` properly, or move drag logic to a JS-only handler. Deferred to Sprint 3.
- `playlists/page.tsx` lines 866, 1001 and `screens/page.tsx` line 414: Modal content `role="document"` divs with `onClick`/`onKeyDown` stopPropagation trigger warn-level `no-noninteractive-element-interactions`. Functionally correct; warn only.

---

**Last Updated:** 2026-04-16 — Sprint 2 complete
