# Touch Kiosk Templates — Intake & Integration Map (2026-06-03)

Source: `EDU CMS-14.zip` → `kiosk-templates/` — a dependency-free kiosk **engine**
(`shared/kiosk-core.js` + `kiosk-core.css`) plus 3 themed verticals
(real-estate leasing, museum exhibits, food/QSR ordering), built by Claude design.

## What it is (verified by reading + rendering)
- **Engine (`Kiosk`)**: in-memory screen router w/ nav stack + animated transitions,
  declarative `data-go`/`data-back`/`data-home`/`data-act` delegation, idle/attract
  reset, tap ripple, inline-SVG icon set, live clock, `Intl` money, bottom-sheet,
  toast, media/video/audio placeholder helpers. ~376 lines, vanilla.
- **Design system**: every size derives from `--u` = `1vmin` → the SAME markup is
  balanced on 1920×1080 landscape AND 1080×1920 portrait. Tokenized color/type via
  `:root[data-theme=...]`. Verified: portrait reflow works (rail→top-bar, grids restack).
- **3 verticals**: each = `index.html` shell + `data.js` (content model) + `app.js`
  (screens) + `styles.css` (theme/layout). All copy lives in `data.js`.
- **Rendered all 6 (3 verticals × 2 orientations) in Chromium: 0 page errors.**
  Production-quality, distinct, premium. Screenshots in this session.

## Sandbox safety (critical for our host) — PASS
Our `EXTERNAL_HTML` widget hosts these as `<iframe sandbox="allow-scripts">` = **null
origin**. A null-origin iframe THROWS on `localStorage`/`sessionStorage`/`cookie`/
`history.pushState`. Grep of all 3 apps + engine: **zero** use of any of those (the
router is in-memory). No active network calls (only a commented POS stub in food). No
risky modern JS (no lookbehind/`toSorted`/etc.). → Safe to host as-is.

## Our integration host: `EXTERNAL_HTML` (the proven pattern)
- Defined `apps/web/src/components/widgets/WidgetRenderer.tsx` (~2753). Renders
  `<iframe sandbox="allow-scripts" src={config.url}>`. Reads config: `url`, `brand`
  (CSS-var overrides), `textOverrides`, `imageOverrides`, `posSync`, etc.
- 81 self-contained HTML templates already live under `apps/web/public/templates/`
  (hs/, signage/qsr/, bar/, healthcare/…). `public/` is served at site root on Vercel.
- A system preset is ONE full-screen `EXTERNAL_HTML` zone:
  ```ts
  { id:'preset-…', name:'…', category:'…', orientation:'LANDSCAPE',
    screenWidth:3840, screenHeight:2160, zones:[
      { name:'Scene', widgetType:'EXTERNAL_HTML', x:0,y:0,width:100,height:100,
        zIndex:1, sortOrder:0, defaultConfig:{ url:'/templates/kiosk/<v>.html' } } ] }
  ```
- Presets live in `apps/api/src/templates/system-presets.ts` (171 presets, exported
  `SYSTEM_TEMPLATE_PRESETS`). `ensure-system-presets.ts` seeds new ids on boot;
  `PRESET_VERTICAL` map optionally tags a non-K12 vertical. No other wiring needed.

## Plan — Part 1 (intake + polish)
1. Inline each vertical to ONE self-contained file `apps/web/public/templates/kiosk/
   {real-estate,museum,food}.html` (core CSS+JS + vertical data+app+styles inlined) —
   matches the HS single-file pattern, robust under the null-origin sandbox, cache-friendly.
2. **Self-host the 3 Google-Fonts families** under `/public/templates/kiosk/fonts/`
   + `@font-face` so kiosks render on OFFLINE panels (HANDOFF flags this; we should DO it).
3. **Brand passthrough**: the templates already theme via CSS vars → map our
   `EXTERNAL_HTML` `brand` config (`--brand-primary`/`--brand-accent`) onto each theme's
   `--accent`/`--accent-2` so a tenant's palette tints the kiosk. ("Better in our system.")
4. Add 3 presets to `system-presets.ts`; tag verticals (food→QSR/RESTAURANT exists;
   real-estate→CORPORATE/HOSPITALITY; museum→HOSPITALITY — or add REAL_ESTATE/MUSEUM
   verticals, a bigger change, flagged optional).
5. Build → commit → push → watch CI green → verify live in the template gallery + player
   (Playwright screenshot) before claiming done.

## Plan — Part 2 (touch widgets) — the honest finding
As self-contained `EXTERNAL_HTML` apps, **these 3 need ZERO new widgets to function** —
the iframe hosts all their touch internally; verified rendering + interaction.
The real gap is a **native touch-widget library** so operators build their OWN kiosks
in our builder (not just drop these 3). The engine demonstrates the vocabulary we lack
natively: quantity **stepper**, **bottom-sheet/modal**, **filter-chips**, **cart/order
summary** (+ POS submit), **gallery** (thumbs→main), **wayfinding you-are-here pin**,
**audio-guide player**, **breadcrumb nav stack**, **idle/attract loop**. Existing native
touch widgets today: TOUCH_POINT, TOUCH_BUTTON, TOUCH_MENU, ROOM_FINDER, WAYFINDING_MAP,
ON_SCREEN_KEYBOARD, QUICK_POLL, WEBPAGE. → Scope decision for the operator.

## Feedback for Claude design — next batch
1. **Self-host fonts** (don't rely on Google Fonts `<link>`; offline panels).
2. **Ship a single inlined HTML per template** (or a build step that inlines) — that's
   our deploy unit for `EXTERNAL_HTML`.
3. **Standardize brand-override var names** to `--brand-primary`/`--brand-accent`/
   `--brand-bg` so our brand injection works with no remapping.
4. **Standardize image-slot attributes** (`data-img="hero"`, `data-slot="suite-1"`) to
   match our `imageOverrides` keying → operators swap photos from our asset library.
5. **Keep the sandbox constraint explicit** (no storage/cookies/history/parent) — it's
   what lets us host with `allow-scripts` null-origin safely.
6. **Align the POS payload** (food) to our POS connector schema (Square/Toast/Clover)
   so it's plug-in, not console.log.
7. **Per-vertical JSON schema for `data.js`** so our CMS/live-data can populate it.
8. **Modern CSS (`color-mix`/`backdrop-filter`/`gap`/`inset`) is fine for LCD touch
   panels but NOT Chromium-83 Taurus LED** — if a template might target an LED wall,
   provide fallbacks; otherwise great.
9. **Next verticals that map to our existing list**: healthcare wayfinding, corporate
   lobby/visitor sign-in, hospitality concierge, retail lookbook, fitness class schedule,
   worship welcome — plus real-estate/museum if we add those verticals.
