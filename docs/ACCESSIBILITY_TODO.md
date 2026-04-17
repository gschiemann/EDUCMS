# Accessibility Sprint 2 Backlog

Violations deferred from Sprint 1. Each file has a `/* eslint-disable */` comment at the top
suppressing the rule for the entire file. Remove the suppression comment when fixing the file.

## Summary

| File | Violations | Primary rule(s) |
|------|-----------|-----------------|
| `app/[schoolId]/assets/page.tsx` | 17 | click-events-have-key-events, no-static-element-interactions, no-autofocus |
| `app/[schoolId]/playlists/page.tsx` | 25 | label-has-associated-control, click-events-have-key-events, no-autofocus |
| `app/[schoolId]/screens/page.tsx` | 12 | click-events-have-key-events, label-has-associated-control, no-autofocus |
| `app/[schoolId]/templates/page.tsx` | 59 | label-has-associated-control, click-events-have-key-events, no-autofocus |
| `app/[schoolId]/settings/page.tsx` | 1 | no-autofocus |
| `app/player/page.tsx` | 6 | click-events-have-key-events, no-static-element-interactions |

Total deferred: ~120 violations across 6 files.

---

## `app/[schoolId]/assets/page.tsx`

- **line 252**: `autoFocus` on URL input inside drop-zone panel — replace with `useEffect(() => ref.current?.focus(), [showUrlForm])`
- **line 258**: Drop-zone `<div>` with `onClick` — add `role="button"`, `tabIndex={0}`, `onKeyDown` handler (Enter/Space triggers click), and `aria-label="Upload files"`
- **line 354**: `autoFocus` on search input — replace with `useEffect`-based focus
- **lines 367, 391, 410, 441, 444, 465, 503, 504, 534**: Various `<div onClick>` and `<li>` with click handlers in the asset grid/list — convert to `<button>` or add `role="button"` + keyboard support

## `app/[schoolId]/playlists/page.tsx`

- **lines 102, 113, 136, 140, 148**: Form labels in the playlist create/edit modal lack `htmlFor`/`id` pairs — add matching `id` to each input/select
- **line 181, 211**: Playlist card `<div onClick>` — convert to `<button>` wrapper or add `role="button"` + `onKeyDown`
- **lines 852, 853, 944, 984, 985**: Drag-handle and slide-item `<div onClick>` elements — add `role="button"` + keyboard handling; consider `@dnd-kit` keyboard preset which is already installed
- **lines 992, 1030, 1049, 1075, 1098**: Widget config `<label>` elements without associated controls — add `htmlFor`/`id`
- **lines 1231, 1280**: `autoFocus` on inline edit inputs — replace with `useEffect`-based focus

## `app/[schoolId]/screens/page.tsx`

- **lines 148, 207, 316, 411**: `autoFocus` on inline inputs — replace with `useEffect`-based focus
- **lines 212, 321**: `<input>` inside `<li>` with `onClick` on the `<li>` — the click is redundant; remove the `onClick` from `<li>` and rely on the native input focus
- **lines 386, 387**: Screen card `<div onClick>` — convert to `<button>` or `<a>` depending on navigation intent
- **lines 403, 416, 426**: Screen name/resolution/orientation `<label>` elements without `htmlFor` — add `id` to each corresponding input

## `app/[schoolId]/templates/page.tsx`

- **lines 278, 279**: Template card `<div onClick>` in the grid — convert to `<button>` wrapper
- **line 286**: `autoFocus` on template name input — replace with `useEffect`
- **line 298**: Template name `<label>` without `htmlFor`
- **lines 678, 679**: Zone `<div onClick>` elements in the canvas editor — add `role="button"` + keyboard support + `aria-label` describing the zone
- **lines 686, 687**: Zone label without `htmlFor`; `autoFocus` on zone name input
- **lines 789, 795, 807, 824, 831, 852, 866, 881, 909**: Widget config panel `<label>` elements (color, font, text content, etc.) without associated controls — batch fix by adding stable `id` attributes to config inputs
- **lines 941, 964, 995, 1138, 1249**: `<div onClick>` / `<div>` with mouse events in sidebar panels — convert to `<button>` or add `role="button"` + keyboard handling
- **lines 1363, 1365**: Template canvas zone selectors with `onClick` — add `role="button"` + `tabIndex={0}` + `onKeyDown`
- **lines 1397–1713**: Approximately 30 widget configuration `<label>` elements without matching `id` on their inputs — this is the largest batch; consider extracting a `<FieldRow label={...} htmlFor={...}>` helper component to avoid repeating the pattern

## `app/[schoolId]/settings/page.tsx`

- **line 175**: `autoFocus` on invite email input — replace with `useEffect(() => ref.current?.focus(), [isInviteOpen])`

## `app/player/page.tsx`

- **lines 518, 590, 623**: Player UI overlay `<div onClick>` elements (swipe-to-dismiss, tap-to-toggle controls) — for touchscreen kiosk use these may be intentional, but for keyboard accessibility add `role="button"` + `tabIndex={0}` + `onKeyDown`; or scope the fix behind a `role="presentation"` with `aria-hidden` if the controls are truly pointer-only
