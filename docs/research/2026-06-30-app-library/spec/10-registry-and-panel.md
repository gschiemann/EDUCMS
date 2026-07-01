# Apps Library — App Registry + Editor "Apps" Panel (build-ready spec)

> Section 10 of the Apps-Library engineering spec. Grounded in the real builder
> code as of 2026-06-30. A mid-level dev (Sonnet-5) should be able to implement
> this without guessing. Every store call, mount site, and data shape below is
> cited to a real file/line so the integration is real, not aspirational.
>
> Reference: `docs/research/2026-06-30-app-library/00-SYNTHESIS.md` §5 (Architecture),
> §6 (Build plan). The synthesis' one-line architecture is:
> *"each app = `{ id, name, icon, category, frictionTier, configSchema, build(config) → a standard zone config }`… ~90% of apps `build()` a WEBPAGE / EXTERNAL_HTML / RSS_FEED / LIVE_DATA / CALENDAR / STREAMING config we already render."*
> This section makes that concrete.

---

## 0. The load-bearing facts this spec is built on

Read these before writing code — they are the contract we plug into.

1. **The builder store is the single source of truth for zones.** It lives at
   `apps/web/src/components/template-builder/useBuilderStore.ts` (Zustand). The
   ONLY sanctioned way to add a zone is `addZone(widgetType, dropAt?)` (line 276)
   which returns the new zone id, then `updateZone(id, patch)` (line 526) to seed
   its `defaultConfig`. **This is exactly how `VariantPicker.handlePick` commits
   a zone today** (`VariantPicker.tsx` line 321-338):
   ```ts
   const id = addZone(v.widgetType);
   updateZone(id, { defaultConfig: { ...(v.defaultConfig || {}), variant: v.id } });
   ```
   The Apps panel MUST use the same two-call path. Do NOT push into `zones`
   directly with `setState` — you'd skip history (`past`/`future`), the `isDirty`
   flag, `clampZone`, `sceneId` inheritance, and auto-select. `addZone` handles
   all of that (lines 277-471). `updateZone` records history only when its 3rd
   arg `commit` is true; for the initial seed we call it once right after add,
   which is fine (the `addZone` snapshot already covers the undo step, matching
   VariantPicker's proven behavior).

2. **`addZone` seeds a per-type `defaultConfig`** via its internal `seedDefault`
   switch (lines 342-407) and canonicalizes `TOUCH_*` → `TOUCH_POINT`,
   `DECORATION_*` → `DECORATION` (lines 419-422). For app widget types (WEBPAGE,
   STREAMING, RSS_FEED, CALENDAR, LIVE_DATA, EXTERNAL_HTML, IMAGE_CAROUSEL, QR_CODE)
   this is either a no-op or a placeholder; our `build(config)` output OVERWRITES
   `defaultConfig` via the follow-up `updateZone`, so the seed doesn't matter.

3. **The render contract is `WidgetRenderer.tsx`'s `case` list**
   (`apps/web/src/components/widgets/WidgetRenderer.tsx`, lines 446-599+). An app's
   `build()` MAY only emit a `widgetType` that has a `case` there. The Phase-1
   apps all target existing cases: `WEBPAGE` (482), `STREAMING` (470), `RSS_FEED`
   (493), `CALENDAR` (456), `LIVE_DATA` (via TICKER 453 / LIVE_DATA if present),
   `IMAGE_CAROUSEL` (459), `EXTERNAL_HTML` (492). The ONLY new render case Phase 1
   needs is **`QR_CODE`** (see §7). Adding a `widgetType` an app emits without a
   matching `WidgetRenderer` case = a blank zone on the player. Verify the case
   exists (rule #9 in CLAUDE.md — verify the render tree) before shipping an app.

4. **The left-panel tab system in `BuilderShell.tsx`** is a `PanelKey` union
   (line 46), a `panels` array (lines 549-562), and a render switch (lines
   697-703). Adding a tab is: extend the union, push an entry, add one line to the
   switch. This is where "Apps" mounts (§3).

5. **Form-field primitives already exist** in `PropertiesPanel.tsx`:
   `TextField` (line 7107), `TextAreaField` (7124), `SelectField` (7328),
   `ToggleField` (8052). They are `function`-scoped (not exported). Our config
   form (§4) reuses the SAME visual language — we export lightweight equivalents
   from a shared module so the Apps form and PropertiesPanel look identical.

---

## 1. The `AppDefinition` interface

New file: **`apps/web/src/components/apps/app-types.ts`**

```ts
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** The zone payload an app produces. widgetType MUST have a matching
 *  case in WidgetRenderer.tsx; defaultConfig is written verbatim onto
 *  the new zone (merged over addZone's seed). Optional geometry lets a
 *  full-bleed app (e.g. Slides) request 0/0/100/100 instead of the
 *  default 40×30. Omit geometry → addZone's default placement/stagger. */
export interface AppZoneSpec {
  widgetType: string;                 // e.g. 'WEBPAGE' | 'STREAMING' | 'RSS_FEED'
  defaultConfig: Record<string, unknown>;
  /** Optional zone box in 0-100 % space. Full-bleed apps set all four. */
  geometry?: { x: number; y: number; width: number; height: number };
  /** Optional friendlier zone name; falls back to app.name in addZone. */
  zoneName?: string;
}

/** How much setup friction the operator faces — drives the badge + sort
 *  order in the picker (synthesis §4.1 "honesty-first, friction-tiered
 *  picker"). Sorted instant → business → managed. */
export type AppFrictionTier =
  | 'instant'    // no login, works immediately (YouTube, QR, Weather, RSS)
  | 'business'   // needs a business login / publish-to-web / API key (Slides, Canva, Reviews)
  | 'managed';   // powered by our aggregator / managed tier (Social Wall)

/** Picker category. Superset of the API's IntegrationCategory
 *  (apps/api/src/integrations/discovery.service.ts line 35) PLUS the
 *  signage-native buckets that have no server connector. Keep the string
 *  union in sync when a new bucket appears. */
export type AppCategory =
  | 'video' | 'docs' | 'calendar' | 'weather' | 'news'
  | 'web' | 'utility' | 'data' | 'social' | 'reviews'
  | 'media' | 'maps' | 'emergency';

/** One field in an app's config form. Rendered by AppConfigForm (§4).
 *  Intentionally small — the 90% of apps only need url/text/select/toggle.
 *  Anything richer (asset picker, POS store dropdown) uses kind:'custom'
 *  with a render fn, so we never balloon this union. */
export type AppFieldType =
  | 'text'        // single-line
  | 'url'         // single-line + URL validation + embeddability preflight hook
  | 'textarea'    // multi-line
  | 'number'      // numeric input
  | 'select'      // <select> from options
  | 'toggle'      // boolean switch
  | 'color'       // color picker (reuses existing ColorField pattern)
  | 'custom';     // escape hatch: caller supplies render()

export interface AppField {
  /** Key written into the config object passed to build(). */
  key: string;
  label: string;
  type: AppFieldType;
  placeholder?: string;
  /** Default value pre-filled in the form (also the value build() sees
   *  if the operator never touches the field). */
  default?: string | number | boolean;
  required?: boolean;
  /** For type:'select'. [value, label] pairs (matches SelectField's shape). */
  options?: Array<[string, string]>;
  /** Short helper line under the field (e.g. "Paste the /embed URL"). */
  help?: string;
  /** For type:'custom'. Receives the live value + setter. */
  render?: (args: {
    value: unknown;
    onChange: (v: unknown) => void;
    all: Record<string, unknown>;   // whole form state (for dependent fields)
  }) => React.ReactNode;
  /** Optional predicate to hide a field unless another field is set
   *  (e.g. show "channel id" only when source === 'channel'). */
  showIf?: (all: Record<string, unknown>) => boolean;
}

export interface AppDefinition {
  /** Stable unique id, kebab-case. Persisted nowhere critical — the
   *  ZONE stores widgetType+config, not the app id — but we DO stamp
   *  config._appId so a future "edit this app" flow can reopen the right
   *  form. Never reuse an id. */
  id: string;
  name: string;                       // "YouTube", "Google Slides"
  /** Lucide icon component (import from lucide-react) OR an inline SVG
   *  string for brand marks lucide lacks (YouTube/Canva logos). */
  icon: LucideIcon | { svg: string };
  category: AppCategory;
  frictionTier: AppFrictionTier;
  /** One-line pitch shown on the card + at top of the config form. */
  blurb: string;
  /** Search keywords beyond name/blurb (e.g. ["gslides","presentation"]). */
  keywords?: string[];
  /** Vertical scoping — same semantics as WidgetVariant.vertical /
   *  .verticals (variants.ts lines 43-56). Unset = universal (all
   *  verticals). Reuse variantVisibleForVertical's rules for filtering. */
  vertical?: string;
  verticals?: string[];
  /** The config form. Empty array = zero-config app (build() ignores
   *  config), e.g. a "News · AP Top Stories" curated-RSS tile. */
  configSchema: AppField[];
  /** Pure function: form values → the zone to create. MUST be
   *  deterministic + side-effect-free (no fetch). Any network work
   *  (URL preflight, oEmbed resolve) happens in the form, not here. */
  build: (config: Record<string, unknown>) => AppZoneSpec;
  /** Optional: hint the live-preview harness (§5) how to render a preview
   *  BEFORE commit. If omitted, preview just runs build() and feeds the
   *  result through WidgetRenderer (works for ~90% of apps). Use this only
   *  when a preview needs a lighter/faster stand-in than the live widget
   *  (e.g. show a static poster instead of autoplaying a stream). */
  livePreview?: {
    /** Override the widgetType used purely for the preview render. */
    widgetType?: string;
    /** Transform build()'s config for preview (e.g. force muted+paused). */
    previewConfig?: (built: AppZoneSpec) => Record<string, unknown>;
  };
  /** Optional Taurus/Chromium-83 compatibility note surfaced as a badge
   *  (synthesis §4.5). 'ok' | 'snapshot' (needs snapshot-to-asset on LED)
   *  | 'no' (won't run on Taurus). Default 'ok'. Purely informational in
   *  Phase 1; wired to the snapshot service in Phase 2. */
  taurus?: 'ok' | 'snapshot' | 'no';
  /** Phase 2+: honesty note shown in the config form for publish-to-web
   *  apps ("this content becomes internet-public"). Free text. */
  exposureWarning?: string;
}
```

### Why these choices (so the implementer doesn't second-guess)

- **`build()` returns a spec object, not a zone.** The panel, not the app,
  owns the store calls — keeps apps pure and testable, and means one code path
  (`AppsPanel.commitApp`) handles history/dirty/geometry for every app.
- **`configSchema` is data, not JSX**, so a Sonnet agent adds an app by writing
  one object literal — no React per app. The `kind:'custom'` field is the single
  escape hatch for the ~10% that need a real component (asset picker, POS store).
- **`frictionTier` + `category` mirror the synthesis' honesty-first picker.**
  `frictionTier` drives sort order and the badge; competitors bury this.

---

## 2. Where the registry lives + how apps register

Mirror the **proven variant-registry pattern** (`variants.ts` +
`variants-register.ts`, imported for boot-time registration by `VariantPicker.tsx`
line 20: `import '@/components/widgets/variants-register';`).

### 2a. Registry module — `apps/web/src/components/apps/app-registry.ts`

```ts
import type { AppDefinition } from './app-types';

const apps = new Map<string, AppDefinition>();

export function registerApp(def: AppDefinition): void {
  if (apps.has(def.id)) {
    // Dev guard — duplicate id silently clobbers, which is the exact
    // class of bug that hid dead WidgetPalette edits (CLAUDE.md #9).
    console.warn(`[app-registry] duplicate app id "${def.id}" — overwriting`);
  }
  apps.set(def.id, def);
}

export function getApp(id: string | undefined): AppDefinition | undefined {
  return id ? apps.get(id) : undefined;
}

export function listApps(): AppDefinition[] {
  return Array.from(apps.values());
}

export function listAppCategories(): AppCategory[] {
  return Array.from(new Set(Array.from(apps.values()).map(a => a.category)));
}
```

### 2b. Boot-time registration — `apps/web/src/components/apps/apps-register.ts`

Side-effect module that imports every app-pack and (each pack) calls
`registerApp(...)` at module load — identical to how `variants-register.ts`
pulls in every variant pack. Structure by category so packs stay reviewable:

```ts
// apps/web/src/components/apps/apps-register.ts
import './packs/video-apps';     // YouTube, Vimeo, Twitch
import './packs/docs-apps';      // Slides, Canva, PowerPoint, Sheets
import './packs/calendar-apps';  // Google/Outlook/iCal
import './packs/weather-apps';   // (wraps existing WEATHER variants)
import './packs/news-apps';      // curated RSS
import './packs/web-apps';       // Web URL, Maps
import './packs/utility-apps';   // QR, Clock/Countdown/Date
import './packs/media-apps';     // cloud-folder slideshow
import './packs/data-apps';      // stocks/crypto/currency
import './packs/social-apps';    // Phase 2: Facebook Page, Social Wall
import './packs/reviews-apps';   // Phase 2: Google/Yelp
```

Each pack file, e.g. `apps/web/src/components/apps/packs/video-apps.ts`:

```ts
import { Youtube } from 'lucide-react';
import { registerApp } from '../app-registry';

registerApp({
  id: 'youtube',
  name: 'YouTube',
  icon: { svg: '<svg …/>' },      // brand mark (lucide's Youtube is fine too)
  category: 'video',
  frictionTier: 'instant',
  blurb: 'Play a YouTube video, playlist, channel, or live stream.',
  keywords: ['video', 'yt', 'stream'],
  taurus: 'ok',
  configSchema: [
    { key: 'urlOrId', label: 'YouTube URL or video ID', type: 'url',
      required: true, placeholder: 'https://youtube.com/watch?v=…',
      help: 'Paste any YouTube link — video, playlist, or channel.' },
    { key: 'autoplay', label: 'Autoplay (muted)', type: 'toggle', default: true },
    { key: 'loop',     label: 'Loop',             type: 'toggle', default: true },
  ],
  build: (config) => {
    const embedUrl = toYouTubeEmbed(String(config.urlOrId ?? ''), {
      autoplay: config.autoplay !== false,
      loop: config.loop !== false,
    });
    return {
      widgetType: 'STREAMING',       // real case: WidgetRenderer.tsx line 470
      zoneName: 'YouTube',
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      defaultConfig: {
        playbackType: 'iframe',      // StreamingCfg shape, StreamingWidget.tsx line 78
        embedUrl,
        muted: config.autoplay !== false,
        fitMode: 'contain',
        _appId: 'youtube',           // reopen-form breadcrumb
      },
    };
  },
});
```

> `toYouTubeEmbed` is a pure helper in the pack file (normalizes watch/short/
> playlist/channel URLs → the `/embed/…?autoplay=1&mute=1&loop=1` form). No
> network. YouTube rides the **existing** `STREAMING` widget with
> `playbackType:'iframe'` + `embedUrl` — see the documented `StreamingCfg` at
> `StreamingWidget.tsx` lines 76-92 (`embedUrl`, `playbackType:'iframe'`,
> `muted`, `fitMode`). **Zero new render code.**

### 2c. Two more `build()` examples showing the "rides an existing widget" pattern

```ts
// Google Slides → WEBPAGE (WidgetRenderer.tsx line 482)
build: (config) => ({
  widgetType: 'WEBPAGE',
  zoneName: 'Google Slides',
  geometry: { x: 0, y: 0, width: 100, height: 100 },
  defaultConfig: { url: normalizeSlidesEmbed(String(config.url)), _appId: 'google-slides' },
})

// News · curated RSS → RSS_FEED (WidgetRenderer.tsx line 493). Zero-config
// app: configSchema:[] and build() ignores config.
build: () => ({
  widgetType: 'RSS_FEED',
  zoneName: 'AP Top Stories',
  defaultConfig: { feedUrl: 'https://…/ap-top.xml', title: 'AP Top Stories', _appId: 'news-ap' },
})
```

---

## 3. The "Apps" panel — component, mount, and commit path

### 3a. New tab in `BuilderShell.tsx`

Three edits, all in `apps/web/src/components/template-builder/BuilderShell.tsx`:

1. **Extend the union** (line 46):
   ```ts
   type PanelKey = 'apps' | 'widgets' | 'background' | 'layers' | 'scenes' | 'properties' | 'brand' | 'review';
   ```
2. **Add the tab entry** to `panels` (lines 549-562). Put **Apps first** so it's
   the primary "add content" entry (synthesis positions the Apps library as the
   headline picker). Import a `LayoutGrid`/`Grid3x3` icon from lucide:
   ```ts
   { key: 'apps',    label: 'Apps',    icon: LayoutGrid },
   { key: 'widgets', label: 'Widgets', icon: Plus },
   … // rest unchanged
   ```
   Note: the tab rail is `flex` with `flex-1` buttons (line 686); 8 tabs still
   fit the 420px `<aside>` (line 674) at the existing `text-[10px]` size — verify
   in the render, but no layout change is expected.
3. **Add the render line** to the panel switch (lines 697-703):
   ```tsx
   {panel === 'apps' && <AppsPanel />}
   ```
   Import it: `import { AppsPanel } from '@/components/apps/AppsPanel';`

**Default panel:** keep `useState<PanelKey>('widgets')` (line 71) for now — do
NOT change the default to `'apps'` in Phase 1 without operator sign-off (per the
memory note *"don't over-engineer / get Greg sign-off before UX-default changes"*).
Coexistence with VariantPicker is covered in §6.

### 3b. `AppsPanel` component — `apps/web/src/components/apps/AppsPanel.tsx`

Two-state panel (like VariantPicker's browse ↔ locked-filter):

- **Grid state (default):** card grid + search + category filter + friction-tier
  badges.
- **Config state:** operator clicked a card → the panel swaps to that app's
  config form (§4) with a live preview (§5) and an "Add to canvas" button.

```tsx
"use client";
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import '@/components/apps/apps-register';            // boot-time registration
import { listApps } from '@/components/apps/app-registry';
import type { AppDefinition, AppCategory } from '@/components/apps/app-types';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { appVisibleForVertical } from './app-visibility';   // mirrors variantVisibleForVertical
import { AppConfigForm } from './AppConfigForm';
import { AppCard } from './AppCard';

const CATEGORY_LABELS: Record<AppCategory, string> = {
  video: 'Video', docs: 'Docs', calendar: 'Calendar', weather: 'Weather',
  news: 'News', web: 'Web', utility: 'Utility', data: 'Data',
  social: 'Social', reviews: 'Reviews', media: 'Media', maps: 'Maps',
  emergency: 'Emergency',
};

const FRICTION_ORDER: Record<string, number> = { instant: 0, business: 1, managed: 2 };

export function AppsPanel() {
  const addZone    = useBuilderStore(s => s.addZone);
  const updateZone = useBuilderStore(s => s.updateZone);
  const select     = useBuilderStore(s => s.select);
  const tenantCopy = useTenantCopy();

  const [search, setSearch]     = useState('');
  const [catFilter, setCat]     = useState<AppCategory | 'ALL'>('ALL');
  const [openAppId, setOpenApp] = useState<string | null>(null);

  const apps = useMemo(() => {
    let list = listApps().filter(a => appVisibleForVertical(a, tenantCopy.vertical));
    if (catFilter !== 'ALL') list = list.filter(a => a.category === catFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.blurb.toLowerCase().includes(q) ||
      (a.keywords || []).some(k => k.includes(q)));
    // Honesty-first sort: instant → business → managed, then A-Z.
    return list.sort((a, b) =>
      (FRICTION_ORDER[a.frictionTier] - FRICTION_ORDER[b.frictionTier]) ||
      a.name.localeCompare(b.name));
  }, [search, catFilter, tenantCopy.vertical]);

  // ── THE COMMIT PATH — the same two store calls VariantPicker uses. ──
  const commitApp = (app: AppDefinition, config: Record<string, unknown>) => {
    const spec = app.build(config);
    // addZone assigns id, applies history/dirty/clampZone/sceneId + auto-selects.
    const id = addZone(spec.widgetType, undefined);
    // Overwrite the seed with the app's config, and apply geometry/name if given.
    const patch: Record<string, unknown> = { defaultConfig: spec.defaultConfig };
    if (spec.geometry) Object.assign(patch, spec.geometry);
    if (spec.zoneName) (patch as any).name = spec.zoneName;
    updateZone(id, patch as any);      // commit=false: addZone's snapshot covers undo
    select(id);
    setOpenApp(null);                  // back to grid
  };

  const openApp = openAppId ? listApps().find(a => a.id === openAppId) : null;

  if (openApp) {
    return (
      <AppConfigForm
        app={openApp}
        onBack={() => setOpenApp(null)}
        onAdd={(config) => commitApp(openApp, config)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* search (copy VariantPicker.tsx lines 371-380 markup verbatim) */}
      {/* category chip row (copy FilterChip from VariantPicker.tsx line 459) */}
      <div className="flex-1 overflow-auto p-3 bg-slate-50/40">
        <div className="grid grid-cols-2 gap-3">
          {apps.map(a => <AppCard key={a.id} app={a} onClick={() => setOpenApp(a.id)} />)}
        </div>
      </div>
    </div>
  );
}
```

> **The commit path is the crux of "real integration":** `addZone` +
> `updateZone` are the SAME functions VariantPicker calls (`VariantPicker.tsx`
> line 336-337). We route geometry through `updateZone`'s `patch` because
> `updateZone` runs `clampZone` (store line 528) so a full-bleed 0/0/100/100
> spec is clamped safely. Auto-select + Properties-panel jump happen for free:
> `addZone` sets `selectedIds:[id]` (store line 463), and BuilderShell's store
> subscription flips the left panel to Properties on any selection change
> (`BuilderShell.tsx` lines 137-153) — so after "Add to canvas" the operator
> lands in the normal per-field editor for the new zone. **No new edit surface
> needed.**

### 3c. `AppCard` — `apps/web/src/components/apps/AppCard.tsx`

Card = icon + name + blurb + **friction-tier badge**. Mirror `VariantTile`'s
tile chrome (`VariantPicker.tsx` lines 489-524) minus the live-render thumbnail
(cards show the app icon, not a widget preview — preview happens in the config
form). Badge copy + color by tier:

| tier | badge label | classes |
|---|---|---|
| `instant` | `Instant · no login` | `bg-emerald-50 text-emerald-700` |
| `business` | `Needs a business login` | `bg-amber-50 text-amber-700` |
| `managed` | `Powered by our social wall` | `bg-indigo-50 text-indigo-700` |

(Exact strings from synthesis §4.1.) If `app.taurus === 'snapshot' | 'no'`, also
render a small "LED" note badge (Phase 2 wires it to the snapshot service).

---

## 4. Per-app config form rendered from `configSchema`

New file: **`apps/web/src/components/apps/AppConfigForm.tsx`**

Renders a header (app icon + name + blurb + friction badge + optional
`exposureWarning` callout), then one control per `AppField`, then a live preview
(§5), then a footer with **Back** and **Add to canvas** (disabled until required
fields are filled).

```tsx
"use client";
import { useMemo, useState } from 'react';
import type { AppDefinition, AppField } from './app-types';
import { AppLivePreview } from './AppLivePreview';
// Re-export the exact same field primitives PropertiesPanel uses so the
// forms are visually identical. See §4a.
import { TextField, TextAreaField, SelectField, ToggleField, ColorField } from './app-fields';

export function AppConfigForm({ app, onBack, onAdd }: {
  app: AppDefinition;
  onBack: () => void;
  onAdd: (config: Record<string, unknown>) => void;
}) {
  // Seed state from field defaults.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(app.configSchema
      .filter(f => f.default !== undefined)
      .map(f => [f.key, f.default])));

  const set = (key: string, v: unknown) => setValues(s => ({ ...s, [key]: v }));

  const visibleFields = app.configSchema.filter(f => !f.showIf || f.showIf(values));
  const missingRequired = app.configSchema.some(f =>
    f.required && (!f.showIf || f.showIf(values)) &&
    (values[f.key] === undefined || values[f.key] === '' ));

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* header: back button, icon, name, blurb, friction badge, exposureWarning */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {visibleFields.map(f => renderField(f, values, set))}
        <AppLivePreview app={app} values={values} />   {/* §5 */}
      </div>
      <div className="border-t border-slate-100 p-3 flex gap-2">
        <button onClick={onBack} className="…">Back</button>
        <button disabled={missingRequired} onClick={() => onAdd(values)} className="…">
          Add to canvas
        </button>
      </div>
    </div>
  );
}

function renderField(f: AppField, values: Record<string, unknown>, set: (k: string, v: unknown) => void) {
  const v = values[f.key];
  switch (f.type) {
    case 'text':
    case 'url':      return <TextField key={f.key} label={f.label} value={String(v ?? '')}
                             placeholder={f.placeholder} onChange={x => set(f.key, x)} help={f.help} />;
    case 'textarea': return <TextAreaField key={f.key} label={f.label} value={String(v ?? '')}
                             placeholder={f.placeholder} onChange={x => set(f.key, x)} />;
    case 'number':   return <NumberField  key={f.key} label={f.label} value={Number(v ?? 0)}
                             onChange={x => set(f.key, x)} />;
    case 'select':   return <SelectField  key={f.key} label={f.label} value={String(v ?? '')}
                             options={f.options ?? []} onChange={x => set(f.key, x)} />;
    case 'toggle':   return <ToggleField  key={f.key} label={f.label} value={!!v}
                             onChange={x => set(f.key, x)} />;
    case 'color':    return <ColorField   key={f.key} label={f.label} value={String(v ?? '')}
                             onChange={x => set(f.key, x)} />;
    case 'custom':   return <div key={f.key}>{f.render?.({ value: v, onChange: x => set(f.key, x), all: values })}</div>;
  }
}
```

### 4a. `app-fields.ts` — shared form primitives

The field components in `PropertiesPanel.tsx` (`TextField` 7107, `SelectField`
7328, `ToggleField` 8052, `TextAreaField` 7124) are `function`-scoped, not
exported. Two options — **pick option A**:

- **Option A (recommended):** Extract those four into a new shared module
  `apps/web/src/components/template-builder/form-fields.tsx`, export them, and
  have BOTH `PropertiesPanel.tsx` and the Apps form import from it. This dedups
  ~100 lines and guarantees identical look. Add `NumberField` + `ColorField` +
  the `help` prop there (`ColorField` — copy the existing color-input pattern
  PropertiesPanel already uses inline; `help` — a `<p className="text-[10px]
  text-slate-400 mt-1">`). Then `app-fields.ts` just re-exports from
  `form-fields`.
  > This is a light refactor of PropertiesPanel (a 10k-line file) — do it as a
  > pure move (cut the 4 functions, paste into `form-fields.tsx`, import them
  > back). Run `pnpm --filter web exec tsc --noEmit` after. No behavior change.

- Option B (fallback if the refactor is deemed risky): copy the four component
  bodies into `app-fields.ts`. Faster, but drifts over time — flag it.

---

## 5. Live preview — reuse `WidgetRenderer`

New file: **`apps/web/src/components/apps/AppLivePreview.tsx`**

The preview runs the app's own `build()` on the current form values and feeds the
result through the SAME `WidgetRenderer` the canvas + `VariantTile` use — so what
the operator previews IS what the zone will render. This is exactly how
`VariantTile` renders its thumbnail live (`VariantPicker.tsx` lines 504-513,
wrapped in `WidgetErrorBoundary`).

```tsx
"use client";
import { useMemo } from 'react';
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import type { AppDefinition } from './app-types';

export function AppLivePreview({ app, values }: {
  app: AppDefinition;
  values: Record<string, unknown>;
}) {
  const preview = useMemo(() => {
    try {
      const spec = app.build(values);
      const widgetType = app.livePreview?.widgetType ?? spec.widgetType;
      const config = app.livePreview?.previewConfig
        ? app.livePreview.previewConfig(spec)
        : spec.defaultConfig;
      return { widgetType, config };
    } catch { return null; }        // incomplete form → no preview yet
  }, [app, values]);

  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-500 mb-1.5">Preview</div>
      <div className="relative w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200"
           style={{ aspectRatio: '16 / 9', fontSize: '14px' }}>
        {preview ? (
          <div className="absolute top-0 right-0 bottom-0 left-0 pointer-events-none">
            {/* Longhand insets — NOT inset-0 (CLAUDE.md rule #10, Taurus). */}
            <WidgetErrorBoundary resetKey={app.id} widgetLabel={app.name}>
              <WidgetRenderer
                widgetType={preview.widgetType}
                config={{ ...preview.config, _thumb: true } as any}
                live={false}          {/* previews don't autoplay/poll */}
                compact={false}
              />
            </WidgetErrorBoundary>
          </div>
        ) : (
          <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-xs text-slate-400">
            Fill in the fields to preview
          </div>
        )}
      </div>
    </div>
  );
}
```

> **Notes for the implementer.**
> - Confirm `WidgetRenderer`'s exact prop names by reading its function
>   signature (top of `WidgetRenderer.tsx`) — the `case` list uses
>   `{ config, compact, live, freeze, onConfigChange }`; pass `live={false}`
>   so the preview iframe/stream does NOT autoplay or poll (cheap + safe).
> - `pointer-events-none` on the wrapper so preview clicks don't hijack the
>   form (same trick as `VariantTile` line 505).
> - **Rule #10:** use longhand `top-0 right-0 bottom-0 left-0`, never `inset-0`
>   — this preview code can end up in a Taurus-adjacent bundle path; keep it safe.
> - The `WidgetErrorBoundary` (real component, used at `VariantPicker.tsx` line
>   510) means a malformed config never blanks the panel.

---

## 6. Coexistence with `VariantPicker` — decision + rationale

**Decision: tab ALONGSIDE VariantPicker. Do NOT replace or feed it.**

- **Keep both tabs.** "Apps" (new) and "Widgets" (existing `VariantPicker`) are
  two distinct mental models:
  - **Apps** = "connect a source / drop a finished thing" (YouTube, Slides,
    Weather, a QR code). Answer to *"how do I get my Google Slides on screen?"*
  - **Widgets** = "add + restyle a native building block" (the 378-variant
    Canva-style wall — clocks, headlines, tickers, per-vertical packs). Answer
    to *"give me a themed clock."*
  Merging them would drown the ~20 curated apps in ~400 variants — the exact
  noise problem the vertical filter (`variantVisibleForVertical`) already fights.

- **Why NOT feed VariantPicker** (i.e. register apps as variants): variants are
  keyed to a `widgetType` and a `render` thumbnail component (`WidgetVariant`,
  `variants.ts` lines 30-79). Apps need a **config form + build() + friction
  tier + category + preview** — a strictly richer contract. Shoehorning apps
  into `WidgetVariant` would either bloat that type or lose the app metadata.
  Separate registry, separate panel = clean.

- **Shared machinery, not shared registry.** They SHARE: the commit path
  (`addZone`/`updateZone`), the form primitives (§4a, after the extract), and
  `WidgetRenderer` for preview. That's the right amount of reuse.

- **One overlap to handle deliberately:** a few apps and variants both target
  the same widget (e.g. YouTube-app and any STREAMING variant → `STREAMING`).
  That's fine and intended — two doors to the same widget, seeded differently.
  No dedup needed. Both write `defaultConfig` via the same store path.

**If a future decision reverses this** (operator wants ONE unified picker),
the migration is small: `AppCard.onClick` already opens a config form, and
VariantPicker's tiles already commit via `addZone`/`updateZone` — a unified
picker would just be a tabbed container over both grids. Design for that by
keeping the two registries independent now.

---

## 7. The one genuinely-new render case: `QR_CODE`

Every Phase-1 app except QR rides an existing `WidgetRenderer` case. QR needs a
new widget (synthesis §2 #7 — client-side SVG QR, offline-safe, Taurus-safe).

1. **Widget:** `apps/web/src/components/widgets/QrCodeWidget.tsx` — renders an
   SVG QR from `config.value` (the URL/text) using a tiny dependency-free QR
   encoder (or `qrcode` if already in the tree — check `package.json` first).
   SVG (not canvas) so it scales crisply at 4K and is Taurus-safe. Honor
   `config.fgColor` / `config.bgColor` (default `#000`/`#fff`) and support a
   `_thumb` shrink like other widgets. **No `inset-0`** (rule #10).
2. **Register the case** in `WidgetRenderer.tsx` (add near the utility widgets):
   ```tsx
   case 'QR_CODE': return <QrCodeWidget config={cfg} />;
   ```
3. **App** (`packs/utility-apps.ts`): `id:'qr-code'`, `category:'utility'`,
   `frictionTier:'instant'`, `taurus:'ok'`, `configSchema` = a `url` field
   (`value`) + two `color` fields; `build()` → `{ widgetType:'QR_CODE',
   defaultConfig:{ value, fgColor, bgColor, _appId:'qr-code' } }`.

> There is already a `TOUCH_QR` **touch-point variant** placeholder
> (`useBuilderStore.ts` line 380 — `qrText`, renders a visual placeholder only).
> The new `QR_CODE` widget is the real, rendering QR. Don't conflate them; the
> app targets `QR_CODE`.

---

## 8. Implementation checklist (order for a Sonnet agent)

1. `app-types.ts` (§1) — interfaces only, no logic. `tsc` clean.
2. `app-registry.ts` (§2a) + `apps-register.ts` skeleton (§2b, empty imports ok).
3. **Extract** form primitives → `form-fields.tsx`; re-import into
   `PropertiesPanel.tsx`; add `NumberField`/`ColorField`/`help` (§4a option A).
   `pnpm --filter web exec tsc --noEmit` — must be clean (10k-line file).
4. `app-fields.ts` re-export shim (§4a).
5. `AppLivePreview.tsx` (§5) — verify `WidgetRenderer` prop names against source.
6. `AppConfigForm.tsx` (§4).
7. `AppCard.tsx` (§3c) + `app-visibility.ts` (mirror `variantVisibleForVertical`,
   `VariantPicker.tsx` lines 205-228).
8. `AppsPanel.tsx` (§3b) — the commit path is the load-bearing part.
9. Wire the tab into `BuilderShell.tsx` (§3a — 3 edits).
10. `QrCodeWidget.tsx` + `WidgetRenderer` case (§7).
11. First app pack (`video-apps.ts` → YouTube) end-to-end; **verify in the
    rendered DOM** (open builder → Apps tab → YouTube → paste URL → preview shows
    → Add → zone appears + Properties opens on it). Per CLAUDE.md #21, do NOT
    claim done until the render is eyeballed.
12. Fill remaining Phase-1 packs (Slides, Calendar, News/RSS, Web URL, Maps,
    Vimeo, PowerPoint, Canva, Sheets, cloud-folder, stocks/crypto/currency,
    Clock/Countdown/Date). Each = one object literal + any pure URL helper.

## 9. Guardrails / gotchas (do not skip)

- **Render-tree verification (CLAUDE.md #9):** after adding the Apps tab, grep
  `grep -rn '<AppsPanel' apps/web/src --include="*.tsx"` — must match the
  BuilderShell mount. A dead panel ships nothing.
- **Every `build().widgetType` MUST have a `WidgetRenderer` case** (§0.3). If an
  app targets a widget that doesn't render, the player shows a blank zone.
- **Taurus / Chromium-83 (CLAUDE.md #10):** any preview/card markup uses longhand
  `top/right/bottom/left`, never `inset-0`; no `gap` on flex rows that could ride
  to the player; no `backdrop-filter` without a fallback. The Apps panel is
  dashboard-only (safe), but `QrCodeWidget` and any preview code that could be
  bundled toward the player path must obey the Taurus rules — run the sweep in
  CLAUDE.md rule #10.
- **Vertical filtering:** reuse the exact `variantVisibleForVertical` logic
  (`VariantPicker.tsx` 205-228) so a gym doesn't see a K-12-scoped app and vice
  versa. `app-visibility.ts` should share the same `vertical`/`verticals` rules.
- **`build()` stays pure** — no fetch, no `Date.now()`-dependent output that would
  make preview and commit diverge. Network (oEmbed, embeddability HEAD check) is
  a Phase-2 concern that lives in the FORM (a `custom` field), never in `build()`.
- **Don't change the default panel** to Apps in Phase 1 (memory: get Greg
  sign-off before UX-default changes).
