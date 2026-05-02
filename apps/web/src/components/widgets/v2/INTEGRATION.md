# V2 Widget Pack — Integration Patches

This pack adds **75 new widgets** across **15 categories**, each with 5 visual styles
(Neon, Paper, Crayon, Glass, Ops) targeting different K-12 audiences.

All widgets live under `apps/web/src/components/widgets/v2/` and register
themselves in `v2/registry.ts`. Two existing files need to be patched to
expose the new widgets in the editor + render them on the canvas.

---

## 1. `apps/web/src/components/template-builder/constants.ts`

**Add** the following block at the very top of `WIDGET_GROUPS` (or anywhere
inside the array — order in palette is the order here).

```ts
import { V2_GROUPS } from '@/components/widgets/v2/registry';

// …existing imports…

// SPLICE the v2 groups into the existing WIDGET_GROUPS const.
// Easiest: change `WIDGET_GROUPS` to a `let` (or rename) and append after declaration:
//
//   export const WIDGET_GROUPS = [...EXISTING_GROUPS, ...V2_GROUPS] as const;
//
// If you'd rather hand-merge, V2_GROUPS exports this exact shape:
//   { label: string; types: { type, label, desc, icon }[] }[]
```

If a hand merge is preferred (so the existing `as const` shape is preserved),
splice the v2 entries directly. Each v2 widget is one entry in a `types` array
with `{ type, label, desc, icon }` — same shape as the existing entries.

Recommended palette grouping order:

```
Clocks · Weather · Headlines · Announcements · Calendars · Staff
Countdowns · Logos · Tickers · Photos · Rich Text · Images
Lunch Menus · Bell Schedules
```

The 75 type strings introduced by this pack:

```
CLOCK_NEON / CLOCK_PAPER / CLOCK_CRAYON / CLOCK_GLASS / CLOCK_OPS
HEADLINE_NEON / HEADLINE_PAPER / HEADLINE_CRAYON / HEADLINE_GLASS / HEADLINE_OPS
ANN_NEON / ANN_PAPER / ANN_CRAYON / ANN_GLASS / ANN_OPS
CAL_NEON / CAL_PAPER / CAL_CRAYON / CAL_GLASS / CAL_OPS
STAFF_NEON / STAFF_PAPER / STAFF_CRAYON / STAFF_GLASS / STAFF_OPS
CD_NEON / CD_PAPER / CD_CRAYON / CD_GLASS / CD_OPS
LOGO_NEON / LOGO_PAPER / LOGO_CRAYON / LOGO_GLASS / LOGO_OPS
TICKER_NEON / TICKER_PAPER / TICKER_CRAYON / TICKER_GLASS / TICKER_OPS
WX_NEON / WX_PAPER / WX_CRAYON / WX_GLASS / WX_OPS
PHOTO_NEON / PHOTO_PAPER / PHOTO_CRAYON / PHOTO_GLASS / PHOTO_OPS
RT_NEON / RT_PAPER / RT_CRAYON / RT_GLASS / RT_OPS
IMG_NEON / IMG_PAPER / IMG_CRAYON / IMG_GLASS / IMG_OPS
LUNCH_NEON / LUNCH_PAPER / LUNCH_CRAYON / LUNCH_GLASS / LUNCH_OPS
BELL_NEON / BELL_PAPER / BELL_CRAYON / BELL_GLASS / BELL_OPS
```

None overlap with existing widget types — safe to splice without touching
existing presets.

---

## 2. `apps/web/src/components/widgets/WidgetRenderer.tsx`

Add ONE block to the existing `switch (widgetType)` dispatch (around line 311
in current file). It catches every `*_NEON / *_PAPER / *_CRAYON / *_GLASS / *_OPS`
type produced by this pack and forwards the zone's config to the widget.

```ts
// near the top, with the other widget imports:
import { V2_BY_TYPE } from './v2/registry';

// …inside the renderWidget switch, BEFORE `default:`:

// ── v2 widget pack (Clocks/Weather/Headlines/Announcements/Calendars/
//    Staff/Countdowns/Logos/Tickers/Photos/RichText/Images/Lunch/Bell)
//    ─ each category × 5 styles × Neon/Paper/Crayon/Glass/Ops.
//    The v2 registry holds the React component for each type string;
//    we look it up here and forward the same `config` + `live` props
//    every other case uses. Falls through to `default:` if the type
//    isn't a v2 widget.
default: {
  const v2 = V2_BY_TYPE[widgetType];
  if (v2) {
    const C = v2.Component;
    return <C config={cfg} live={live} />;
  }
  // …existing default behaviour (placeholder / unknown widget) below…
}
```

If there is already a `default:` clause, splice the V2 lookup as the FIRST
thing it does. The lookup is `O(1)` and falls through cleanly when not a v2
type.

That's it — no other files need to change.

---

## 3. (Optional) Default seeding in `useBuilderStore.ts`

The v2 widgets all ship sensible defaults baked into their components, so
empty configs render fine. If you want preset content per type, the
`defaults` field on each `RegisteredWidget` in `v2/registry.ts` is
empty by default — add objects there and have `useBuilderStore` consult
`V2_BY_TYPE[type]?.defaults` when seeding a new zone.

---

## Smoke test

```
pnpm --filter web typecheck
pnpm --filter web build
```

Then open the new template builder, drag any v2 widget from the palette,
and verify it renders on the canvas. The Properties Panel won't have
custom editors yet — every v2 widget's `config.style` accepts the same
`WidgetStyle` shape (`fontFamily`, `fontSize`, `textColor`, `bgColor`,
`bgGradient`, `padding`, `borderRadius`, `accentColor`, …) so a generic
"Style" form on PropertiesPanel can drive every one of them.
